import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker using the bundled worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ─── Utility: generate a cover image from first page of PDF ─────────────────
async function generatePdfCover(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const loadingTask = pdfjs.getDocument({ data: e.target.result });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function KindleWoodLibrary() {
  const [activeTab, setActiveTab] = useState('all');
  const [greeting, setGreeting] = useState('Welcome to your cozy reading nook.');
  const [books, setBooks] = useState([
    { id: 1, title: 'The Martian', author: 'Andy Weir', favorite: true, cover: 'https://images.unsplash.com/photo-1614728263952-84ea256f9679?q=80&w=400&h=600&fit=crop', pdfUrl: null },
    { id: 2, title: 'Dune', author: 'Frank Herbert', favorite: false, cover: 'https://images.unsplash.com/photo-1541963463532-d68292c34b19?q=80&w=400&h=600&fit=crop', pdfUrl: null },
    { id: 3, title: '1984', author: 'George Orwell', favorite: true, cover: 'https://images.unsplash.com/photo-1505664177922-2415531539bf?q=80&w=400&h=600&fit=crop', pdfUrl: null },
    { id: 4, title: 'Project Hail Mary', author: 'Andy Weir', favorite: false, cover: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=400&h=600&fit=crop', pdfUrl: null },
  ]);
  const [openBook, setOpenBook] = useState(null); // book being read
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

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

    // Extract a clean title from filename
    const rawName = file.name.replace(/\.pdf$/i, '');
    const title = rawName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Untitled Book';

    const pdfUrl = URL.createObjectURL(file);
    const cover = await generatePdfCover(file);

    setBooks((prev) => [
      ...prev,
      {
        id: Date.now(),
        title,
        author: 'Unknown Author',
        favorite: false,
        cover,
        pdfUrl,
      },
    ]);
    setIsUploading(false);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }, []);

  const displayedBooks =
    activeTab === 'favorites' ? books.filter((b) => b.favorite) : books;

  return (
    <>
      {/* ── PDF Reader Overlay ─────────────────────────────────────── */}
      {openBook && (
        <PDFReader book={openBook} onClose={() => setOpenBook(null)} />
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
          disabled={isUploading}
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
function BookCard({ book, onClick }) {
  const hasPdf = !!book.pdfUrl;
  return (
    <div
      onClick={onClick}
      className={`group flex flex-col transition-transform duration-300 hover:-translate-y-2 relative ${hasPdf ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {book.favorite && (
        <div className="absolute top-4 right-4 z-20 bg-white/80 dark:bg-black/80 backdrop-blur-md p-2 rounded-full shadow-sm">
          <span className="text-red-500 text-xs">❤️</span>
        </div>
      )}

      {hasPdf && (
        <div className="absolute top-4 left-4 z-20 bg-amber-600/90 backdrop-blur-md px-2 py-0.5 rounded-full shadow-sm">
          <span className="text-white text-[10px] font-semibold tracking-wide">PDF</span>
        </div>
      )}

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

// ─── PDF Reader ───────────────────────────────────────────────────────────────
function PDFReader({ book, onClose }) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef(null);
  const pageRefs = useRef({});

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Intersection observer to track current visible page
  useEffect(() => {
    if (!numPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let visiblePage = currentPage;
        entries.forEach((entry) => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            visiblePage = Number(entry.target.dataset.page);
          }
        });
        if (maxRatio > 0) setCurrentPage(visiblePage);
      },
      { root: containerRef.current, threshold: Array.from({ length: 11 }, (_, i) => i / 10) }
    );
    Object.values(pageRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [numPages]);

  const scrollToPage = (n) => {
    pageRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  };

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

        {/* Zoom controls */}
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
            className="flex flex-col items-center"
          >
            {numPages &&
              Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <div
                  key={pageNum}
                  ref={(el) => (pageRefs.current[pageNum] = el)}
                  data-page={pageNum}
                  className="my-4 shadow-2xl"
                >
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    className="block"
                  />
                </div>
              ))}
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
    </div>
  );
}