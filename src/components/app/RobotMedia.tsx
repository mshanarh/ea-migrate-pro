type RobotMediaProps = {
  image: string;
  video?: string | undefined;
  /** "hero" = background layer (autoplay muted loop, no controls); "avatar" = framed player with controls. */
  variant: "hero" | "avatar";
  className: string;
};

/**
 * Renders the robot's uploaded video when one exists (from the mentor dashboard's
 * EA Video/GIF upload), otherwise the static image. Heroes autoplay muted+looped
 * behind the overlay; avatars get visible playback controls.
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
        preload="metadata"
      />
    );
  }
  return <img src={image} alt="" className={className} />;
}
