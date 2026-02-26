import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker using the bundled worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ─── Utility: extract PDF metadata + render cover from first page ─────────────
async function extractPdfMeta(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const loadingTask = pdfjs.getDocument({ data: e.target.result });
        const pdf = await loadingTask.promise;

        // Pull embedded metadata
        const meta = await pdf.getMetadata().catch(() => ({}));
        const info = meta?.info ?? {};
        const metaTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
        const metaAuthor = typeof info.Author === 'string' ? info.Author.trim() : '';

        // Render first page as cover thumbnail (0.6 scale — plenty for a card thumbnail)
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.6 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const cover = canvas.toDataURL('image/jpeg', 0.8);

        resolve({ metaTitle, metaAuthor, cover });
      } catch {
        resolve({ metaTitle: '', metaAuthor: '', cover: null });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Utility: query Google Books API for book info ────────────────────────────
async function fetchBookInfo(query) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    const vol = item.volumeInfo;
    return {
      title: vol.title?.trim() || '',
      author: (vol.authors?.[0] ?? '').trim(),
      cover: vol.imageLinks?.thumbnail?.replace('http:', 'https:') ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Utility: clean filename into a readable title ────────────────────────────
function titleFromFilename(filename) {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Untitled Book';
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function KindleWoodLibrary() {
  const [activeTab, setActiveTab] = useState('all');
  const [greeting, setGreeting] = useState('Welcome to your cozy reading nook.');
  const [books, setBooks] = useState([]);
  const [openBook, setOpenBook] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingBook, setPendingBook] = useState(null); // data waiting for user confirmation
  const fileInputRef = useRef(null);

  // ── Bookmarks: { [bookId]: number[] } persisted in localStorage ──────────────
  const [bookmarks, setBookmarks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kw_bookmarks') || '{}'); }
    catch { return {}; }
  });

  const updateBookmarks = useCallback((bookId, updater) => {
    setBookmarks((prev) => {
      const next = { ...prev, [bookId]: updater(prev[bookId] || []) };
      localStorage.setItem('kw_bookmarks', JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning. Coffee and a book?');
    else if (hour < 18) setGreeting('Good afternoon. Ready to read?');
    else if (hour < 22) setGreeting('Good evening. What are we reading today?');
    else setGreeting('Late night reading, I see.');
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') return;
    setIsUploading(true);

    // Kick off both in parallel: PDF processing and Google Books lookup start at the same time.
    // The filename-based title is available immediately, so no need to wait for PDF metadata.
    const fileTitle = titleFromFilename(file.name);
    const [
      { metaTitle, metaAuthor, cover: pdfCover },
      bookInfo,
    ] = await Promise.all([
      extractPdfMeta(file),
      fetchBookInfo(fileTitle),   // start network call right away using filename
    ]);

    // Compose best-guess data — prefer Google Books, fall back to PDF metadata, then filename
    const pdfUrl = URL.createObjectURL(file);
    setPendingBook({
      pdfUrl,
      cover: bookInfo?.cover || pdfCover,
      title: bookInfo?.title || metaTitle || fileTitle,
      author: bookInfo?.author || metaAuthor || '',
    });

    setIsUploading(false);
    e.target.value = '';
  }, []);

  const handleBookConfirm = useCallback(({ title, author }) => {
    if (!pendingBook) return;
    setBooks((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: title.trim() || 'Untitled Book',
        author: author.trim() || 'Unknown Author',
        favorite: false,
        cover: pendingBook.cover,
        pdfUrl: pendingBook.pdfUrl,
      },
    ]);
    setPendingBook(null);
  }, [pendingBook]);

  const handleBookCancel = useCallback(() => {
    if (pendingBook?.pdfUrl) URL.revokeObjectURL(pendingBook.pdfUrl);
    setPendingBook(null);
  }, [pendingBook]);

  const toggleFavorite = useCallback((id) => {
    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, favorite: !b.favorite } : b))
    );
  }, []);

  const [bookToDelete, setBookToDelete] = useState(null);

  const handleDeleteRequest = useCallback((book) => {
    setBookToDelete(book);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!bookToDelete) return;
    // Free the blob URL so memory isn't leaked
    if (bookToDelete.pdfUrl) URL.revokeObjectURL(bookToDelete.pdfUrl);
    setBooks((prev) => prev.filter((b) => b.id !== bookToDelete.id));
    // Close reader if this book was open
    setOpenBook((cur) => (cur?.id === bookToDelete.id ? null : cur));
    setBookToDelete(null);
  }, [bookToDelete]);

  const handleDeleteCancel = useCallback(() => {
    setBookToDelete(null);
  }, []);

  const displayedBooks =
    activeTab === 'favorites' ? books.filter((b) => b.favorite) : books;

  return (
    <>
      {/* ── Book Info Confirmation Modal ───────────────────────────── */}
      {pendingBook && (
        <BookInfoModal
          initialData={pendingBook}
          onConfirm={handleBookConfirm}
          onCancel={handleBookCancel}
        />
      )}

      {/* ── Delete Confirmation Modal ──────────────────────────────── */}
      {bookToDelete && (
        <DeleteConfirmModal
          book={bookToDelete}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}

      {/* ── PDF Reader Overlay ─────────────────────────────────────── */}
      {openBook && (
        <PDFReader
          book={openBook}
          onClose={() => setOpenBook(null)}
          bookmarks={bookmarks[openBook.id] || []}
          onUpdateBookmarks={(updater) => updateBookmarks(openBook.id, updater)}
        />
      )}

      {/* ── Main Library Page ──────────────────────────────────────── */}
      <div className="min-h-screen bg-[#f7f5f2] dark:bg-[#0a0806] p-12 pb-28 transition-colors duration-300 font-sans relative overflow-hidden">
        {/* Ambient light blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-amber-600/30 dark:bg-amber-700/20 rounded-full blur-[120px] pointer-events-none z-0" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-orange-400/20 dark:bg-orange-900/20 rounded-full blur-[150px] pointer-events-none z-0" />

        <div className="relative z-10">
          {/* Header */}
          <header className="mb-12 max-w-7xl mx-auto">
            <h1 className="text-5xl font-serif tracking-tight text-neutral-800 dark:text-neutral-100">
              KindleWood
            </h1>
            <p className="text-lg text-neutral-500 dark:text-neutral-400 mt-2">{greeting}</p>

            <div className="mt-8 flex space-x-2">
              {['all', 'favorites'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeTab === tab
                    ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-black shadow-md'
                    : 'text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                    }`}
                >
                  {tab === 'all' ? 'All Books' : 'Favorites'}
                </button>
              ))}
            </div>
          </header>

          {/* Book Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 max-w-7xl mx-auto">
            {displayedBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onClick={() => book.pdfUrl && setOpenBook(book)}
                onToggleFavorite={toggleFavorite}
                onDelete={handleDeleteRequest}
              />
            ))}
          </div>
        </div>

        {/* Hidden PDF input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Floating "Add Book" button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || !!pendingBook}
          className="fixed bottom-10 right-10 z-50 group flex items-center justify-center w-16 h-16 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full shadow-2xl hover:w-44 transition-all duration-300 overflow-hidden active:scale-90 cursor-pointer border border-neutral-800 dark:border-neutral-200 disabled:opacity-60"
          title="Upload a PDF"
        >
          {isUploading ? (
            <span className="animate-spin text-xl">⏳</span>
          ) : (
            <>
              <span className="absolute text-3xl transition-transform duration-300 group-hover:-translate-y-16">
                +
              </span>
              <span className="absolute text-sm font-medium whitespace-nowrap scale-0 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100 tracking-wide">
                Add Book
              </span>
            </>
          )}
        </button>
      </div>
    </>
  );
}

// ─── BookCard ────────────────────────────────────────────────────────────────
function BookCard({ book, onClick, onToggleFavorite, onDelete }) {
  const hasPdf = !!book.pdfUrl;
  return (
    <div
      onClick={onClick}
      className={`group flex flex-col transition-transform duration-300 hover:-translate-y-2 relative ${hasPdf ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {/* ── Heart toggle — top-left, always visible ── */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(book.id); }}
        className={`absolute top-3 left-3 z-20 p-1.5 rounded-full backdrop-blur-md shadow-sm transition-all duration-200 ${book.favorite
          ? 'bg-red-500/20 text-red-500 scale-110'
          : 'bg-white/70 dark:bg-black/60 text-neutral-400 hover:text-red-400 hover:bg-red-500/10'
          }`}
        title={book.favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24"
          fill={book.favorite ? 'currentColor' : 'none'}
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'fill 0.2s ease' }}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>

      {/* ── PDF badge — top-right ── */}
      {hasPdf && (
        <div className="absolute top-3 right-3 z-20 bg-amber-600/90 backdrop-blur-md px-2 py-0.5 rounded-full shadow-sm">
          <span className="text-white text-[10px] font-semibold tracking-wide">PDF</span>
        </div>
      )}

      {/* ── Trash button — bottom-right, appears on hover ── */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(book); }}
        className="absolute bottom-[4.5rem] right-3 z-20 p-1.5 rounded-full bg-white/70 dark:bg-black/60 backdrop-blur-md shadow-sm text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
        title="Remove from library"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>

      <div className="w-full aspect-[2/3] rounded-2xl bg-white/40 dark:bg-black/40 backdrop-blur-md shadow-md overflow-hidden z-10">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
          />
        ) : (
          <DefaultCover title={book.title} />
        )}
      </div>

      <div className="w-full bg-white/60 dark:bg-neutral-800/60 backdrop-blur-md rounded-b-2xl px-4 grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-[grid-template-rows] duration-300 opacity-0 group-hover:opacity-100 -mt-4 pt-4 shadow-sm">
        <div className="overflow-hidden text-center">
          <div className="pb-4 pt-3">
            <h3 className="text-base font-serif font-bold text-neutral-900 dark:text-white truncate">
              {book.title}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{book.author}</p>
            {hasPdf && (
              <p className="text-xs text-amber-600 mt-1 font-medium">Click to read →</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Default cover when no image ─────────────────────────────────────────────
function DefaultCover({ title }) {
  const colors = [
    ['#2d1b69', '#11998e'],
    ['#8e0e00', '#1f1c18'],
    ['#1a1a2e', '#16213e'],
    ['#0f3460', '#533483'],
    ['#2c3e50', '#fd746c'],
  ];
  const idx = title.charCodeAt(0) % colors.length;
  const [from, to] = colors[idx];
  return (
    <div
      className="w-full h-full flex items-center justify-center p-4"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className="text-white text-center text-sm font-serif font-semibold leading-snug line-clamp-4 opacity-90">
        {title}
      </span>
    </div>
  );
}

// ─── Book Info Confirmation Modal ─────────────────────────────────────────────
function BookInfoModal({ initialData, onConfirm, onCancel }) {
  const [title, setTitle] = useState(initialData.title);
  const [author, setAuthor] = useState(initialData.author);

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm({ title, author });
  };

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #1c1a17 0%, #252320 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Amber glow top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full blur-[60px] pointer-events-none"
          style={{ background: 'rgba(217,119,6,0.15)' }} />

        <div className="relative z-10 p-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-7">
            <div>
              <h2 className="text-white font-serif text-xl font-bold leading-tight">Confirm Book Details</h2>
              <p className="text-neutral-500 text-xs mt-1">We found this info automatically — review and edit if needed.</p>
            </div>
            <button
              onClick={onCancel}
              className="text-neutral-600 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/10 ml-4 shrink-0"
              title="Cancel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex gap-6">
            {/* Cover preview */}
            <div className="shrink-0 w-28 aspect-[2/3] rounded-xl overflow-hidden shadow-lg border border-white/10">
              {initialData.cover ? (
                <img
                  src={initialData.cover}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center p-2"
                  style={{ background: 'linear-gradient(135deg, #2d1b69, #11998e)' }}
                >
                  <span className="text-white text-center text-xs font-serif font-semibold leading-snug opacity-90">
                    {title || 'No Cover'}
                  </span>
                </div>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 tracking-wider uppercase mb-1.5">
                  Book Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter book title…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-amber-500/60 focus:bg-white/8 transition-all duration-200"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 tracking-wider uppercase mb-1.5">
                  Author
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Enter author name…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-amber-500/60 focus:bg-white/8 transition-all duration-200"
                />
              </div>

              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #d97706, #b45309)' }}
                >
                  Add to Library
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────
function DeleteConfirmModal({ book, onConfirm, onCancel }) {
  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #1c1a17 0%, #252320 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Red glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 rounded-full blur-[50px] pointer-events-none"
          style={{ background: 'rgba(239,68,68,0.12)' }}
        />

        <div className="relative z-10 p-7">
          {/* Icon + heading */}
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-full bg-red-500/15 text-red-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-serif text-lg font-bold leading-tight">Remove Book?</h2>
              <p className="text-neutral-500 text-xs mt-0.5">This can't be undone.</p>
            </div>
          </div>

          {/* Book preview row */}
          <div className="flex items-center gap-4 p-3 rounded-2xl mb-6" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="w-10 aspect-[2/3] rounded-lg overflow-hidden shrink-0 shadow-md">
              {book.cover ? (
                <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #2d1b69, #11998e)' }} />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{book.title}</p>
              <p className="text-neutral-500 text-xs truncate">{book.author}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-200"
            >
              Keep it
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PDF Reader ───────────────────────────────────────────────────────────────
// How many pages above and below the current page to keep rendered.
// Everything outside this window is replaced by a lightweight placeholder div.
const PDF_RENDER_BUFFER = 2;

function PDFReader({ book, onClose, bookmarks, onUpdateBookmarks }) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loadError, setLoadError] = useState(false);
  const [pdfDark, setPdfDark] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  // Base page dimensions at scale:1. Fetched from PDF metadata — zero pixels rendered.
  // Used to give placeholder divs the correct height so the scrollbar stays accurate.
  const [baseDims, setBaseDims] = useState({ width: 612, height: 792 }); // A4 fallback

  const containerRef = useRef(null);
  const pageRefs = useRef({});
  const ioThrottleRef = useRef(null); // timer handle for IntersectionObserver throttle
  const ratioMapRef = useRef({}); // persistent map: { [pageNumber]: intersectionRatio }

  const isCurrentPageBookmarked = bookmarks.includes(currentPage);

  const toggleBookmark = () => {
    onUpdateBookmarks((prev) =>
      prev.includes(currentPage)
        ? prev.filter((p) => p !== currentPage)
        : [...prev, currentPage].sort((a, b) => a - b)
    );
  };

  const removeBookmark = (page) => {
    onUpdateBookmarks((prev) => prev.filter((p) => p !== page));
  };

  // ── Close on Escape ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Stable IntersectionObserver with persistent ratio map ─────────────────
  // Fix for page-number flicker: instead of scanning only the *changed* entries
  // (which caused 4↔5 oscillation mid-scroll), we maintain a persistent map of
  // every page's latest ratio. The current page only shifts when a candidate
  // page holds >60% of the viewport — the "majority wins" rule.
  useEffect(() => {
    if (!numPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // 1. Update the persistent ratio map with whatever just changed
        entries.forEach((entry) => {
          ratioMapRef.current[entry.target.dataset.page] = entry.intersectionRatio;
        });

        // 2. Throttle the React setState so we render at most ~10×/sec
        if (ioThrottleRef.current) return;
        ioThrottleRef.current = setTimeout(() => {
          ioThrottleRef.current = null;

          // 3. Scan the FULL map to find the page with the highest visibility
          let bestPage = null;
          let bestRatio = 0;
          Object.entries(ratioMapRef.current).forEach(([page, ratio]) => {
            if (ratio > bestRatio) { bestRatio = ratio; bestPage = Number(page); }
          });

          // 4. Only commit if the winner has >60% of the viewport
          //    (prevents flickering when two pages share roughly equal screen space)
          if (bestPage !== null && bestRatio > 0.6) {
            setCurrentPage(bestPage);
          }
        }, 100);
      },
      { root: containerRef.current, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] }
    );
    Object.values(pageRefs.current).forEach((el) => el && observer.observe(el));
    return () => {
      observer.disconnect();
      if (ioThrottleRef.current) { clearTimeout(ioThrottleRef.current); ioThrottleRef.current = null; }
    };
  }, [numPages]);

  const scrollToPage = (n) => {
    pageRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onDocumentLoadSuccess = useCallback(async (pdf) => {
    setNumPages(pdf.numPages);
    setCurrentPage(1);
    // Fetch first-page viewport without rendering any pixels — just geometry.
    // Gives placeholder divs the right aspect ratio for any PDF, not just A4.
    try {
      const firstPage = await pdf.getPage(1);
      const vp = firstPage.getViewport({ scale: 1 });
      setBaseDims({ width: vp.width, height: vp.height });
    } catch { /* keep A4 defaults */ }
  }, []);

  // ── Windowed page set ──────────────────────────────────────────────────────
  // Only pages inside this Set actually mount a <Page> (canvas + text layer).
  // All other slots are cheap <div> placeholders with fixed dimensions.
  const renderedPages = useMemo(() => {
    if (!numPages) return new Set();
    const start = Math.max(1, currentPage - PDF_RENDER_BUFFER);
    const end = Math.min(numPages, currentPage + PDF_RENDER_BUFFER);
    const set = new Set();
    for (let i = start; i <= end; i++) set.add(i);
    return set;
  }, [currentPage, numPages]);

  // Placeholder size — scales correctly whenever the user zooms
  const placeholderW = Math.round(baseDims.width * scale);
  const placeholderH = Math.round(baseDims.height * scale);

  // Dark mode filter: only applied to PDF page pixels
  const pageFilter = pdfDark
    ? 'invert(1) hue-rotate(180deg) brightness(0.88) contrast(1.05)'
    : 'none';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#1a1814]" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#111]/80 backdrop-blur border-b border-white/10 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
            title="Close (Esc)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <div>
            <h2 className="text-white font-semibold text-sm leading-tight">{book.title}</h2>
            <p className="text-neutral-500 text-xs">{book.author}</p>
          </div>
        </div>

        {/* Page controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1.5 rounded hover:bg-white/10 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-neutral-300 text-sm tabular-nums min-w-[80px] text-center">
            {numPages ? `${currentPage} / ${numPages}` : '…'}
          </span>
          <button
            onClick={() => scrollToPage(Math.min(numPages || 1, currentPage + 1))}
            disabled={!numPages || currentPage >= numPages}
            className="text-neutral-400 hover:text-white disabled:opacity-30 p-1.5 rounded hover:bg-white/10 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        {/* Zoom + dark-mode toggle */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))}
              className="text-neutral-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-all text-lg leading-none"
              title="Zoom out"
            >−</button>
            <span className="text-neutral-300 text-xs w-10 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
              className="text-neutral-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-all text-lg leading-none"
              title="Zoom in"
            >+</button>
          </div>

          {/* Dark/light pill toggle */}
          <button
            onClick={() => setPdfDark((d) => !d)}
            title={pdfDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 12px 5px 8px', borderRadius: '999px',
              border: pdfDark ? '1px solid rgba(245,200,66,0.4)' : '1px solid rgba(255,255,255,0.12)',
              background: pdfDark ? 'rgba(245,200,66,0.12)' : 'rgba(255,255,255,0.07)',
              color: pdfDark ? '#f5c842' : '#a3a3a3',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.25s ease', letterSpacing: '0.02em',
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '20px', height: '20px', borderRadius: '50%',
              background: pdfDark ? 'rgba(245,200,66,0.18)' : 'rgba(255,255,255,0.1)',
              transition: 'all 0.25s ease', flexShrink: 0,
            }}>
              {pdfDark ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
            </span>
            {pdfDark ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>

      {/* ── Scrollable Page Area ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin"
        style={{ scrollbarColor: '#444 #1a1814' }}
      >
        {loadError ? (
          <div className="flex items-center justify-center h-full text-neutral-400 text-center px-8">
            <div>
              <div className="text-5xl mb-4">📄</div>
              <p className="text-lg font-semibold text-white mb-2">Unable to load PDF</p>
              <p className="text-sm">The file may be corrupted or unsupported.</p>
            </div>
          </div>
        ) : (
          <Document
            file={book.pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={() => setLoadError(true)}
            loading={
              <div className="flex items-center justify-center h-64 text-neutral-400">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm">Loading PDF…</p>
                </div>
              </div>
            }
            className="flex flex-col items-center py-4"
          >
            {numPages && Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
              const isRendered = renderedPages.has(pageNum);
              return (
                <div
                  key={pageNum}
                  ref={(el) => (pageRefs.current[pageNum] = el)}
                  data-page={pageNum}
                  className="my-4"
                  style={{
                    // ─ Windowing ────────────────────────────────────────────────
                    // Placeholder keeps the exact footprint of a real rendered page
                    // so the scrollbar length stays accurate for the full document.
                    width: isRendered ? undefined : `${placeholderW}px`,
                    height: isRendered ? undefined : `${placeholderH}px`,
                    // Subtle skeleton tint so the user can see blank "page" slots
                    background: isRendered ? undefined : 'rgba(255,255,255,0.025)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                    // ─ GPU compositing hint ─────────────────────────────────────
                    // Promotes each page to its own GPU layer so the browser can
                    // scroll using the compositor thread — no CPU paint on every frame.
                    willChange: 'transform',
                    // ─ Dark mode ────────────────────────────────────────────────
                    filter: isRendered ? pageFilter : 'none',
                    transition: 'filter 0.35s ease',
                  }}
                >
                  {/* Only mount the heavy <Page> when inside the render window */}
                  {isRendered && (
                    <Page
                      pageNumber={pageNum}
                      scale={scale}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="block"
                    />
                  )}
                </div>
              );
            })}
          </Document>
        )}
      </div>

      {/* ── Progress bar ── */}
      {numPages && (
        <div className="h-0.5 bg-neutral-800 shrink-0">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${(currentPage / numPages) * 100}%` }}
          />
        </div>
      )}

      {/* ── Bookmark Panel (slide-in from right) ── */}
      {bookmarkPanelOpen && (
        <div
          style={{ position: 'fixed', top: '58px', left: 0, right: 0, bottom: 0, zIndex: 110 }}
          onClick={() => setBookmarkPanelOpen(false)}
        >
          <div
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: '288px',
              display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(160deg, #1a1612 0%, #211e18 100%)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
              animation: 'slideInRight 0.25s cubic-bezier(0.22,1,0.36,1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
              <div className="flex items-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span style={{ color: '#e5e0d5', fontWeight: 600, fontSize: '14px', letterSpacing: '0.01em' }}>Bookmarks</span>
                {bookmarks.length > 0 && (
                  <span style={{
                    background: 'rgba(245,158,11,0.18)', color: '#f59e0b',
                    borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                    padding: '1px 7px', border: '1px solid rgba(245,158,11,0.3)',
                  }}>{bookmarks.length}</span>
                )}
              </div>
              <button
                onClick={() => setBookmarkPanelOpen(false)}
                style={{ color: '#6b6b6b', padding: '4px', borderRadius: '6px', cursor: 'pointer' }}
                className="hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Bookmark list */}
            <div className="flex-1 overflow-y-auto py-3 px-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
              {bookmarks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '14px',
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="8" x2="12" y2="14" />
                      <line x1="9" y1="11" x2="15" y2="11" />
                    </svg>
                  </div>
                  <p style={{ color: '#5a5650', fontSize: '13px', lineHeight: 1.5 }}>
                    No bookmarks yet.<br />Navigate to a page and press the ribbon button.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {bookmarks.map((page) => (
                    <div
                      key={page}
                      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-150"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                      onClick={() => { scrollToPage(page); setBookmarkPanelOpen(false); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245,158,11,0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    >
                      {/* Ribbon icon */}
                      <div style={{
                        width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0,
                        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      {/* Label */}
                      <div className="flex-1 min-w-0">
                        <p style={{ color: '#d4cfca', fontSize: '13px', fontWeight: 600 }}>Page {page}</p>
                        <p style={{ color: '#4a4742', fontSize: '11px' }}>{numPages ? `of ${numPages}` : ''}</p>
                      </div>
                      {/* Jump arrow */}
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"
                        style={{ opacity: 0.6, flexShrink: 0 }}>
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeBookmark(page); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove bookmark"
                        style={{ color: '#6b6b6b', padding: '3px', borderRadius: '5px', cursor: 'pointer', flexShrink: 0 }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#6b6b6b'}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Current page quick-add footer */}
            <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <button
                onClick={toggleBookmark}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95"
                style={isCurrentPageBookmarked ? {
                  background: 'rgba(239,68,68,0.1)', color: '#f87171',
                  border: '1px solid rgba(239,68,68,0.25)',
                } : {
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.25)',
                }}
              >
                {isCurrentPageBookmarked ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    Remove Page {currentPage}
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="8" x2="12" y2="14" />
                      <line x1="9" y1="11" x2="15" y2="11" />
                    </svg>
                    Bookmark Page {currentPage}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Bookmark Button ── */}
      {numPages && (
        <div
          style={{
            position: 'fixed',
            bottom: '28px',
            right: '28px',
            zIndex: 105,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '10px',
          }}
        >
          {/* Mini bookmark count pill — shown when there are bookmarks */}
          {bookmarks.length > 0 && !bookmarkPanelOpen && (
            <button
              onClick={() => setBookmarkPanelOpen(true)}
              title="Open bookmarks"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 10px 5px 8px', borderRadius: '999px',
                background: 'rgba(26,22,18,0.92)', backdropFilter: 'blur(10px)',
                border: '1px solid rgba(245,158,11,0.3)',
                color: '#f59e0b', fontSize: '12px', fontWeight: 700,
                cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                transition: 'all 0.2s ease',
                animation: 'floatUp 0.3s cubic-bezier(0.22,1,0.36,1)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.15)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(26,22,18,0.92)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {bookmarks.length} {bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}
            </button>
          )}

          {/* Main ribbon FAB */}
          <button
            onClick={toggleBookmark}
            onContextMenu={(e) => { e.preventDefault(); setBookmarkPanelOpen(true); }}
            title={isCurrentPageBookmarked ? `Remove bookmark (p.${currentPage}) · Right-click to manage` : `Bookmark page ${currentPage} · Right-click to manage`}
            style={{
              width: '50px',
              height: '60px',
              borderRadius: '10px 10px 4px 4px',
              border: 'none',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: isCurrentPageBookmarked
                ? '0 6px 28px rgba(245,158,11,0.45), 0 2px 8px rgba(0,0,0,0.6)'
                : '0 6px 24px rgba(0,0,0,0.5)',
              transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
              background: isCurrentPageBookmarked
                ? 'linear-gradient(160deg,#f59e0b,#d97706)'
                : 'linear-gradient(160deg,#2a2520,#1a1612)',
              transform: 'translateY(0)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px) scale(0.96)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)'; }}
          >
            {/* Ribbon notch at the bottom */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '16px',
              background: isCurrentPageBookmarked ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.04)',
              clipPath: 'polygon(0 0, 50% 55%, 100% 0, 100% 100%, 0 100%)',
            }} />
            {/* Icon */}
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingBottom: '6px',
            }}>
              {isCurrentPageBookmarked ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="8" x2="12" y2="14" />
                  <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
              )}
            </div>
            {/* Border overlay */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 'inherit',
              border: isCurrentPageBookmarked ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(245,158,11,0.25)',
              pointerEvents: 'none',
            }} />
          </button>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes floatUp {
          from { transform: translateY(10px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}