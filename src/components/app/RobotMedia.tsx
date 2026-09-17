type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = background layer (muted loop, no controls); "avatar" = framed player with controls. */
  variant: "hero" | "avatar";
  className: string;
};

/**
 * Renders the robot's uploaded video when one exists (from the mentor dashboard's
 * EA Video/GIF upload), otherwise the static image.
 *
 * RobotMedia is only mounted on the HOME screen themes, which gives the exact
 * behaviour requested: the video starts playing when the user presses HOME in
 * the bottom nav (muted autoplay so browsers allow it; the framed variant keeps
 * controls for sound/fullscreen). No other screen ever mounts the video.
 */
export function RobotMedia({ image, video, variant, className }: RobotMediaProps) {
  if (video) {
    return (
      <video
        src={video}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        controls={variant === "avatar"}
        preload="auto"
      />
    );
  }
  return <img src={image} alt="" className={className} />;
}
