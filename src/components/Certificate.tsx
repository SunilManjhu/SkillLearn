import React, { useState, useEffect } from 'react';
import { Award, Share2, Download, Globe, ShieldCheck, Linkedin, ExternalLink, ShieldAlert, CheckCircle2, X } from 'lucide-react';
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

  const shareUrl = `${window.location.origin}${window.location.pathname}?cert_id=${certificateId}&cert_course=${course.id}&cert_user=${encodeURIComponent(userName)}&cert_date=${date}`;
  
  const handleLinkedInShare = () => {
    const title = encodeURIComponent(`I just completed "${course.title}" on SkillStream!`);
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(linkedInUrl, '_blank', 'width=600,height=600');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    alert('Certificate link copied to clipboard!');
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="no-print mb-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-xl">
        <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">
              {isPublic ? 'Certificate' : 'Your Certificate'}
            </h2>
            {!isPublic && (
              <p className="text-sm text-[var(--text-secondary)] mt-1">Congratulations on completing this course!</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)]"
            aria-label="Close certificate"
          >
            <X size={20} />
          </button>
        </div>

      {!isPublic && (
        <div className="p-6 flex flex-wrap items-center justify-end gap-3 no-print">
            <button
              onClick={handleLinkedInShare}
              className="flex items-center gap-2 px-4 py-2 bg-[#0077b5] hover:bg-[#006396] text-white rounded-lg font-bold transition-colors"
            >
              <Linkedin size={18} />
              Share on LinkedIn
            </button>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--hover-bg)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)]/80 rounded-lg font-bold transition-colors"
            >
              <Share2 size={18} />
              Copy Link
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-bold transition-colors"
            >
              <Download size={18} />
              Download PDF
            </button>
        </div>
      )}
      </div>

      {/* Revamped Certificate Design */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-[#fcfbf9] text-slate-900 rounded-sm shadow-2xl overflow-hidden aspect-[1.414/1] border-[1px] border-slate-200"
        id="certificate-content"
      >
        {/* Subtle Texture/Pattern */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 0.5px, transparent 0.5px)', backgroundSize: '20px 20px' }} />
        
        {/* Elegant Border Frame */}
        <div className="absolute inset-8 border border-slate-300 pointer-events-none" />
        <div className="absolute inset-10 border-[3px] border-slate-100 pointer-events-none" />
        
        <div className="relative h-full flex flex-col items-center justify-between py-20 px-24 text-center">
          {/* Top Section */}
          <div className="w-full flex justify-between items-start">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-slate-900 rounded-sm flex items-center justify-center text-white font-bold text-sm">S</div>
              <span className="font-montserrat text-xs font-bold tracking-[0.2em] text-slate-900">SKILLSTREAM</span>
            </div>
            <div className="text-right">
              <p className="font-montserrat text-[10px] font-bold text-slate-400 uppercase tracking-widest">Official Certification</p>
              <p className="font-montserrat text-[9px] text-slate-400">Verify at skillstream.com/verify</p>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col items-center justify-center space-y-10">
            <div className="space-y-4">
              <h2 className="font-montserrat text-sm font-bold uppercase tracking-[0.4em] text-slate-400">Certificate of Completion</h2>
              <div className="w-12 h-0.5 bg-orange-500 mx-auto" />
            </div>

            <div className="space-y-2">
              <p className="font-serif text-lg text-slate-500 italic">This is to certify that</p>
              <h3 className="font-serif text-6xl font-medium text-slate-900 tracking-tight">
                {userName}
              </h3>
            </div>

            <div className="space-y-4">
              <p className="font-serif text-lg text-slate-500 italic">has successfully completed the requirements for</p>
              <h4 className="font-serif text-4xl font-bold text-slate-900 max-w-3xl mx-auto leading-tight">
                {course.title}
              </h4>
              <div className="flex items-center justify-center gap-4 text-[10px] font-montserrat font-bold text-slate-400 uppercase tracking-widest">
                <span>{course.category}</span>
                <span className="w-1 h-1 bg-slate-300 rounded-full" />
                <span>{course.level} Level</span>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="w-full flex items-end justify-between">
            <div className="text-left space-y-1">
              <p className="font-montserrat text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date of Issue</p>
              <p className="font-serif text-xl text-slate-900">{date}</p>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-white border border-slate-100 p-1 shadow-sm">
                <div className="w-full h-full bg-slate-900 flex items-center justify-center p-1">
                  <div className="grid grid-cols-4 grid-rows-4 gap-0.5 w-full h-full">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className={`bg-white ${Math.random() > 0.5 ? 'opacity-100' : 'opacity-20'}`} />
                    ))}
                  </div>
                </div>
              </div>
              <p className="font-montserrat text-[8px] text-slate-400 tracking-tighter">ID: {certificateId}</p>
            </div>

            <div className="text-right space-y-1">
              <p className="font-montserrat text-[10px] font-bold text-slate-400 uppercase tracking-widest">Verified By</p>
              <div className={`flex items-center justify-end gap-1 ${isVerified === false ? 'text-red-600' : 'text-emerald-600'}`}>
                {isVerified === false ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
                <span className="font-montserrat text-[10px] font-bold">
                  {isVerified === false ? 'UNVERIFIED RECORD' : 'SKILLSTREAM ACADEMY'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {isPublic && (
        <div className="mt-12 text-center space-y-6">
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
          .no-print { display: none !important; }
          body { background: white !important; padding: 0 !important; }
          #certificate-content { 
            box-shadow: none !important; 
            border: none !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
          }
        }
      `}} />
    </div>
  );
};
