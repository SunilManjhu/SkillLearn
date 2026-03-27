import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { Share2, Download, Globe, ShieldCheck, Linkedin, ExternalLink, ShieldAlert, X, Copy } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Course } from '../data/courses';

interface CertificateProps {
  course: Course;
  userName: string;
  date: string;
  certificateId: string;
  isPublic?: boolean;
  onClose: () => void;
}

const CERTIFICATE_PRINT_ROOT_CLASS = 'printing-certificate-pdf';

type StashedDisplay = { el: HTMLElement; display: string };

/** Hide DOM branches that do not contain #certificate-content so print layout is one page (visibility:hidden still reserves space). */
function stashAndHideNonCertificatePath(root: HTMLElement, cert: HTMLElement): StashedDisplay[] {
  const stashed: StashedDisplay[] = [];

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === cert || child.contains(cert)) {
        if (child !== cert) walk(child);
      } else {
        stashed.push({ el: child, display: child.style.display });
        child.style.display = 'none';
      }
    }
  };

  walk(root);
  return stashed;
}

function restoreStashedDisplay(stashed: StashedDisplay[]) {
  for (const { el, display } of stashed) {
    if (display) el.style.display = display;
    else el.style.removeProperty('display');
  }
}

export const Certificate: React.FC<CertificateProps> = ({ 
  course, 
  userName, 
  date, 
  certificateId,
  isPublic = false,
  onClose,
}) => {
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [verificationError, setVerificationError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [shareStatus, setShareStatus] = useState<'idle' | 'shared'>('idle');

  const canWebShare = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    []
  );

  useEffect(() => {
    if (isPublic) {
      const verify = async () => {
        try {
          const snap = await getDoc(doc(db, 'certificates', certificateId));
          if (snap.exists()) {
            const data = snap.data();
            // Basic verification of course and user
            if (data.courseId === course.id) {
              setIsVerified(true);
            } else {
              setIsVerified(false);
            }
          } else {
            setIsVerified(false);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'certificates');
          setVerificationError(true);
        }
      };
      verify();
    }
  }, [isPublic, certificateId, course.id]);

  useDialogKeyboard({
    open: true,
    onClose,
    onPrimaryAction: onClose,
  });

  const shareUrl = `${window.location.origin}${window.location.pathname}?cert_id=${certificateId}&cert_course=${course.id}&cert_user=${encodeURIComponent(userName)}&cert_date=${date}`;
  
  const handleLinkedInShare = () => {
    const title = encodeURIComponent(`I just completed "${course.title}" on SkillStream!`);
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(linkedInUrl, '_blank', 'width=600,height=600');
  };

  const handleCopyLink = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopyStatus('copied');
        window.setTimeout(() => setCopyStatus('idle'), 2500);
      } catch {
        window.prompt('Copy this certificate link:', shareUrl);
      }
    })();
  };

  const handleSystemShare = useCallback(async () => {
    if (!canWebShare) return;
    const text = `I just completed "${course.title}" on SkillStream!`;
    try {
      await navigator.share({
        title: 'SkillStream certificate',
        text,
        url: shareUrl,
      });
      setShareStatus('shared');
      window.setTimeout(() => setShareStatus('idle'), 2500);
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'AbortError') return;
    }
  }, [canWebShare, course.title, shareUrl]);

  const handlePrintPdf = useCallback(() => {
    const root = document.getElementById('root');
    const cert = document.getElementById('certificate-content');
    if (!root || !cert || !(cert instanceof HTMLElement)) {
      window.print();
      return;
    }

    const prevTitle = document.title;
    document.title = '';

    const stashed = stashAndHideNonCertificatePath(root, cert);
    document.documentElement.classList.add(CERTIFICATE_PRINT_ROOT_CLASS);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      restoreStashedDisplay(stashed);
      document.title = prevTitle;
      document.documentElement.classList.remove(CERTIFICATE_PRINT_ROOT_CLASS);
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    window.setTimeout(cleanup, 3000);

    window.print();
  }, []);

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl">
      <div className="no-print mb-4 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl sm:mb-6">
        <div className="relative flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:gap-4 sm:px-6 sm:pb-6 sm:pt-6 sm:flex-row sm:items-start sm:justify-start">
          <div className="min-w-0 flex-1 pr-11 sm:min-w-0 sm:flex-1 sm:pr-0">
            <h2 className="text-lg font-bold leading-tight text-[var(--text-primary)] sm:text-xl">
              {isPublic ? 'Certificate' : 'Your Certificate'}
            </h2>
            {!isPublic && (
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                Congratulations on completing this course!
              </p>
            )}
          </div>

          {!isPublic && (
            <div className="flex w-full min-w-0 flex-1 flex-col gap-3 sm:max-w-none sm:items-end">
              <div className="w-full sm:max-w-md sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:text-sm sm:normal-case sm:tracking-normal">
                  Share your certificate
                </p>
              </div>

              <p className="sr-only" aria-live="polite">
                {copyStatus === 'copied' && 'Certificate link copied to clipboard.'}
                {shareStatus === 'shared' && 'Share completed.'}
              </p>

              <div
                className="flex w-full min-w-0 flex-row flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] [-ms-overflow-style:none] [scrollbar-width:none] sm:w-auto sm:items-stretch sm:justify-end sm:overflow-visible sm:pb-0 sm:pl-0 sm:pr-0 [&::-webkit-scrollbar]:hidden"
              >
                <button
                  type="button"
                  onClick={handleLinkedInShare}
                  className="inline-flex h-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-lg bg-[#0077b5] px-2.5 text-xs font-bold text-white transition-colors hover:bg-[#006396] active:bg-[#005a87] sm:h-auto sm:min-h-0 sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm"
                  aria-label="Share certificate on LinkedIn"
                >
                  <Linkedin size={16} className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" aria-hidden />
                  <span className="whitespace-nowrap">LinkedIn</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`inline-flex h-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-colors sm:h-auto sm:min-h-0 sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm ${
                    copyStatus === 'copied'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
                      : 'border-[var(--border-color)] bg-[var(--hover-bg)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)]/80'
                  }`}
                  aria-label={copyStatus === 'copied' ? 'Link copied' : 'Copy certificate link to clipboard'}
                >
                  <Copy size={16} className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" aria-hidden />
                  <span className="whitespace-nowrap">
                    {copyStatus === 'copied' ? (
                      'Copied!'
                    ) : (
                      <>
                        <span className="sm:hidden">Copy</span>
                        <span className="hidden sm:inline">Copy link</span>
                      </>
                    )}
                  </span>
                </button>
                {canWebShare && (
                  <button
                    type="button"
                    onClick={() => void handleSystemShare()}
                    className={`inline-flex h-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2.5 text-xs font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)]/80 sm:h-auto sm:min-h-0 sm:min-w-0 sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm ${
                      shareStatus === 'shared' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700' : ''
                    }`}
                    aria-label={
                      shareStatus === 'shared'
                        ? 'Shared'
                        : 'Share certificate link using another app'
                    }
                  >
                    <Share2 size={16} className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" aria-hidden />
                    <span className="whitespace-nowrap sm:hidden">
                      {shareStatus === 'shared' ? 'Shared' : 'Share'}
                    </span>
                    <span className="hidden whitespace-nowrap sm:inline">
                      {shareStatus === 'shared' ? 'Shared' : 'More apps'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  title="Download PDF — Tip: In the print dialog, disable “Headers and footers” to remove the date, URL, and page numbers from the PDF."
                  className="inline-flex h-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-2.5 text-xs font-bold text-white transition-colors hover:bg-orange-600 active:bg-orange-700 sm:h-auto sm:min-h-0 sm:min-w-0 sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm"
                  aria-label="Download certificate as PDF"
                >
                  <Download size={16} className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" aria-hidden />
                  <span className="whitespace-nowrap sm:hidden">Download</span>
                  <span className="hidden whitespace-nowrap sm:inline">Download PDF</span>
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:static sm:right-auto sm:top-auto sm:self-start"
            aria-label="Close certificate"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Revamped Certificate Design — nested borders in document flow so footer stays inside frames */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-full overflow-hidden rounded-sm border border-slate-200 bg-[#fcfbf9] text-slate-900 shadow-2xl"
        id="certificate-content"
      >
        {/* Subtle Texture/Pattern */}
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(#000 0.5px, transparent 0.5px)', backgroundSize: '20px 20px' }}
        />

        {/* No flex-1 / fixed aspect: border boxes must grow with content so the footer stays inside the frame */}
        <div className="relative z-[1] flex w-full min-w-0 flex-col p-3 sm:p-5 md:p-7 lg:p-8">
          <div className="flex w-full min-w-0 flex-col border border-slate-300">
            <div className="flex w-full min-w-0 flex-col border-[3px] border-slate-100 px-4 py-6 text-center sm:px-6 sm:py-8 md:px-10 md:py-10 lg:px-12 lg:py-12">
              <div className="flex w-full min-w-0 flex-col items-center gap-8 sm:gap-10">
          {/* Top Section */}
          <div className="flex w-full min-w-0 flex-col items-center justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-slate-900 text-sm font-bold text-white sm:h-8 sm:w-8">S</div>
              <span className="font-montserrat text-[10px] font-bold tracking-[0.2em] text-slate-900 sm:text-xs">SKILLSTREAM</span>
            </div>
            <div className="text-center sm:text-right">
              <p className="font-montserrat text-[9px] font-bold uppercase tracking-widest text-slate-400 sm:text-[10px]">Official Certification</p>
              <p className="font-montserrat text-[8px] text-slate-400 sm:text-[9px]">Verify at skillstream.com/verify</p>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex w-full min-w-0 flex-col items-center space-y-6 sm:space-y-8 md:space-y-10">
            <div className="space-y-3 sm:space-y-4">
              <h2 className="font-montserrat text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400 sm:text-sm sm:tracking-[0.4em]">
                Certificate of Completion
              </h2>
              <div className="mx-auto h-0.5 w-10 bg-orange-500 sm:w-12" />
            </div>

            <div className="space-y-1 sm:space-y-2">
              <p className="font-serif text-sm italic text-slate-500 sm:text-base md:text-lg">This is to certify that</p>
              <h3 className="break-words font-serif text-3xl font-medium leading-tight tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
                {userName}
              </h3>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <p className="font-serif text-sm italic text-slate-500 sm:text-base md:text-lg">
                has successfully completed the requirements for
              </p>
              <h4 className="mx-auto max-w-3xl break-words font-serif text-xl font-bold leading-tight text-slate-900 sm:text-3xl md:text-4xl">
                {course.title}
              </h4>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 font-montserrat sm:gap-4 sm:text-[10px]">
                <span>{course.category}</span>
                <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block" aria-hidden />
                <span>{course.level} Level</span>
              </div>
            </div>
          </div>

          {/* Bottom Section — grid keeps columns inside frame; min-w-0 avoids clipping (e.g. “DATE” → “ATE”) */}
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 sm:grid-cols-3 sm:items-end sm:gap-3 md:gap-4">
            <div className="min-w-0 space-y-1 text-center sm:text-left">
              <p className="font-montserrat text-[9px] font-bold uppercase tracking-widest text-slate-400 sm:text-[10px]">
                Date of Issue
              </p>
              <p className="break-words font-serif text-base text-slate-900 sm:text-xl">{date}</p>
            </div>

            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              <div className="h-14 w-14 shrink-0 border border-slate-100 bg-white p-1 shadow-sm sm:h-16 sm:w-16">
                <div className="flex h-full w-full items-center justify-center bg-slate-900 p-1">
                  <div className="grid h-full w-full grid-cols-4 grid-rows-4 gap-0.5">
                    {[
                      1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1,
                    ].map((on, i) => (
                      <div key={i} className={`bg-white ${on ? 'opacity-100' : 'opacity-25'}`} />
                    ))}
                  </div>
                </div>
              </div>
              <p className="w-full max-w-full break-all px-1 font-montserrat text-[7px] leading-snug tracking-tight text-slate-400 sm:text-[8px]">
                ID: {certificateId}
              </p>
            </div>

            <div className="min-w-0 space-y-1 text-center sm:text-right">
              <p className="font-montserrat text-[9px] font-bold uppercase tracking-widest text-slate-400 sm:text-[10px]">
                Verified By
              </p>
              <div
                className={`flex flex-wrap items-center justify-center gap-1 sm:justify-end ${isVerified === false ? 'text-red-600' : 'text-emerald-600'}`}
              >
                {isVerified === false ? <ShieldAlert size={14} className="shrink-0" /> : <ShieldCheck size={14} className="shrink-0" />}
                <span className="min-w-0 break-words font-montserrat text-[9px] font-bold sm:text-[10px]">
                  {isVerified === false ? 'UNVERIFIED RECORD' : 'SKILLSTREAM ACADEMY'}
                </span>
              </div>
            </div>
          </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {isPublic && (
        <div className="no-print mt-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/10 text-orange-500 rounded-full text-sm font-bold">
            <Globe size={16} />
            Publicly Verified Certificate
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Ready to build your own skills?</h2>
          <p className="text-[var(--text-secondary)] max-w-xl mx-auto">
            Join {userName} and millions of others learning on SkillStream. Get access to 7,000+ expert-led courses.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="/"
              className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
            >
              Start Learning for Free
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            margin: 12mm;
            size: auto;
          }
          html, body {
            background: white !important;
            color: #0f172a !important;
            margin: 0 !important;
            padding: 0 !important;
            min-height: 0 !important;
            height: auto !important;
          }
          /* Collapse app shell height so we do not get a blank second page */
          html.printing-certificate-pdf .min-h-screen {
            min-height: 0 !important;
          }
          html.printing-certificate-pdf main {
            padding: 0 !important;
            margin: 0 !important;
            min-height: 0 !important;
          }
          #certificate-content,
          #certificate-content * {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          #certificate-content {
            position: relative !important;
            left: auto !important;
            top: auto !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 0 !important;
            overflow: visible !important;
            transform: none !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}} />
    </div>
  );
};
