import { youtubeEmbedSrcForVideoId, youtubeVideoIdFromUrl } from '../utils/youtube';

type YoutubeUrlPreviewEmbedProps = {
  url: string;
  title?: string;
  className?: string;
};

/**
 * Same embed framing as CoursePlayer “Customize lesson” (Replace / Suggest video tabs).
 */
export function YoutubeUrlPreviewEmbed({
  url,
  title = 'YouTube preview',
  className = '',
}: YoutubeUrlPreviewEmbedProps) {
  const vid = youtubeVideoIdFromUrl(url);
  if (!vid) return null;
  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl border border-[var(--border-color)] bg-black ${className}`.trim()}
    >
      <iframe
        src={youtubeEmbedSrcForVideoId(vid)}
        title={title}
        className="absolute inset-0 h-full w-full border-0"
        allowFullScreen
      />
    </div>
  );
}
