import {
  YOUTUBE_EMBED_BOTTOM_CROP_PX,
  YOUTUBE_EMBED_TOP_CROP_PX,
  youtubeEmbedSrcForVideoId,
  youtubeVideoIdFromUrl,
} from '../utils/youtube';

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
        className="absolute left-0 right-0 w-full border-0"
        style={{
          top: -YOUTUBE_EMBED_TOP_CROP_PX,
          height: `calc(100% + ${YOUTUBE_EMBED_TOP_CROP_PX + YOUTUBE_EMBED_BOTTOM_CROP_PX}px)`,
        }}
        allowFullScreen
      />
    </div>
  );
}
