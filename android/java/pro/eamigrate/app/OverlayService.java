package pro.eamigrate.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Chat-head style floating bot bubble — a round bot avatar that FLOATS
 * above every app (MetaTrader included), draggable anywhere. Long-press
 * dismisses the bubble.
 *
 * v1.8 — TAP EXPANDS IN PLACE: tapping the bubble no longer re-opens the
 * app (that yanked the trader out of MetaTrader). Instead a trade-log card
 * EXPANDS over whatever app is in front — EA picture header, the robot's
 * name, "SERVER CONNECTED" and the live trade log. Tap the ✕ (or the bubble
 * again after collapse) to fold it back. Exactly the same content as the
 * in-app popup, but native and always on top.
 *
 * v1.8 — REAL EA PICTURE: EA images are stored as base64 data URLs by the
 * portal. They are decoded directly (BitmapFactory on the base64 payload);
 * http(s) URLs still stream as before. A failure falls back to the app icon.
 *
 * Foreground service (Oreo+): runs with a minimal persistent "EA Migrate
 * Bot Running" notification so Android will NOT kill the floating window
 * while MetaTrader or another heavy app holds the foreground. The service
 * promotes to foreground before anything else, whatever the intent says —
 * the 5-second startForeground contract is never violated.
 */
public class OverlayService extends Service {
    private static OverlayService instance;

    /** Where a site-relative image path (the app's own "/logo.png") lives. */
    private static final String SITE_ORIGIN = "https://eamigratepro.vercel.app";
    /** Pixels: the bubble is 56dp and the card header 170dp — bigger is waste. */
    private static final int MAX_DIMENSION = 512;

    private WindowManager wm;
    private View bubble;
    private String lastLine = "";
    private String imageUrl;
    private String eaName = "EA Migrate";

    /** Expanded trade-log card state. */
    private View expanded;
    private LinearLayout expandedLogList;
    private final Deque<String> logHistory = new ArrayDeque<>();
    private static final int MAX_LOG_LINES = 6;

    public static void push(String line) {
        if (instance != null) {
            instance.setLine(line);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Oreo+ requires a call to startForeground() within ~5s of
        // startForegroundService() — promote FIRST, whatever the intent says,
        // so a stop request can never crash with ForegroundServiceDidNotStart.
        // v1.7 HARDENING: a missing FOREGROUND_SERVICE permission (or a
        // SecurityException from OEM-specific foreground-service rules) used
        // to CRASH the whole app — "EA Migrate keeps stopping" right after
        // license activation, repeatedly, because the service is sticky.
        // The bubble now degrades to "not shown" instead of ever crashing.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                promoteToForeground();
            }
        } catch (Exception e) {
            android.util.Log.e("EAMIGRATE", "startForeground failed — bubble disabled this session: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && intent.getBooleanExtra("stop", false)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                stopForeground(true); // drop the notification before stopping
            }
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && intent.hasExtra("log")) {
            setLine(intent.getStringExtra("log"));
            return START_STICKY;
        }
        if (intent != null && intent.hasExtra("image")) {
            imageUrl = intent.getStringExtra("image");
        }
        if (intent != null && intent.hasExtra("name")) {
            String name = intent.getStringExtra("name");
            if (name != null && !name.trim().isEmpty()) {
                eaName = name.trim();
            }
        }
        show();
        return START_STICKY;
    }

    /**
     * Minimal persistent "EA Migrate Bot Running" notification (Oreo+).
     * Foreground status is what stops Android from killing the floating
     * window while MetaTrader or another heavy app holds the foreground.
     */
    private void promoteToForeground() {
        String channelId = "eamigrate_bot";
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
                channelId,
                "EA Migrate Bot Running",
                NotificationManager.IMPORTANCE_LOW); // silent — no sound/vibration while trading
        channel.setDescription("Keeps the floating bot bubble alive over other apps");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        Notification notification = new Notification.Builder(this, channelId)
                .setContentTitle("EA Migrate Bot Running")
                .setContentText("Your bot bubble is floating over other apps")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .build();
        startForeground(1001, notification);
    }

    private void setLine(final String line) {
        lastLine = line == null ? "" : line;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                synchronized (logHistory) {
                    logHistory.addLast(lastLine);
                    while (logHistory.size() > MAX_LOG_LINES) {
                        logHistory.removeFirst();
                    }
                }
                if (expandedLogList != null) {
                    rebuildExpandedLog();
                }
            }
        });
    }

    /** Re-render the expanded card's log lines from history. */
    private void rebuildExpandedLog() {
        if (expandedLogList == null) return;
        expandedLogList.removeAllViews();
        List<String> lines = new ArrayList<>();
        synchronized (logHistory) {
            lines.addAll(logHistory);
        }
        if (lines.isEmpty()) {
            lines.add(eaName + " is ready to execute trades");
            lines.add("Select pair and press Scan");
        }
        for (int i = 0; i < lines.size(); i++) {
            TextView row = new TextView(this);
            String text = lines.get(i);
            row.setText("> " + text);
            row.setTextSize(11f);
            row.setTypeface(Typeface_MONOSPACE());
            boolean isLatest = i == lines.size() - 1;
            row.setTextColor(isLatest ? Color.parseColor("#4ADE80") : Color.parseColor("#D1D5DB"));
            expandedLogList.addView(row);
        }
    }

    /** Small helper so the monospace typeface reads cleanly above. */
    private static android.graphics.Typeface Typeface_MONOSPACE() {
        return android.graphics.Typeface.MONOSPACE;
    }

    private void show() {
        if (bubble != null) {
            return;
        }
        instance = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        final FrameLayout container = new FrameLayout(this);
        container.setLayoutParams(new FrameLayout.LayoutParams(dp(62), dp(62)));

        final ImageView bot = new ImageView(this);
        FrameLayout.LayoutParams imageParams =
                new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER);
        bot.setLayoutParams(imageParams);
        bot.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(Color.parseColor("#0A0F1E"));
        ring.setStroke(dp(3), Color.parseColor("#2E5BFF"));
        // Red = the accent used for trades, errors and the primary UI identity.
        bot.setBackground(ring);
        bot.setClipToOutline(true);
        container.addView(bot);
        loadBitmap(bot);

        final View dot = new View(this);
        FrameLayout.LayoutParams dotParams =
                new FrameLayout.LayoutParams(dp(13), dp(13), Gravity.BOTTOM | Gravity.END);
        dotParams.setMargins(0, 0, dp(2), dp(2));
        dot.setLayoutParams(dotParams);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(Color.parseColor("#22C55E"));
        dot.setBackground(dotBg);
        // Amber — status/feature highlights behind the green dot.
        container.addView(dot);

        // Single-line log under the avatar is dropped in v1.8 — the avatar
        // stays clean; the full log lives in the expanded card.

        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dp(62),
                dp(62),
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(12);
        params.y = dp(320);

        // Drag model: TOTAL displacement from the original press decides what
        // a release means. Per-event deltas miss slow drags (each event moves
        // only 2–3px, never crossing a per-event threshold, so the gesture
        // was misread as a long-press and the bubble DISAPPEARED mid-drag).
        final float[] origin = new float[2];       // where the finger went down
        final float[] last = new float[2];         // previous event position
        final boolean[] dragged = new boolean[1];  // total displacement > slop
        final long[] downAt = new long[1];
        final int touchSlop = dp(8);
        container.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        origin[0] = event.getRawX();
                        origin[1] = event.getRawY();
                        last[0] = origin[0];
                        last[1] = origin[1];
                        dragged[0] = false;
                        downAt[0] = System.currentTimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - last[0];
                        float dy = event.getRawY() - last[1];
                        last[0] = event.getRawX();
                        last[1] = event.getRawY();
                        params.x += (int) dx;
                        params.y += (int) dy;
                        // TOTAL displacement from the press point marks this
                        // gesture as a drag — however SLOWLY the finger moves.
                        float totalDx = event.getRawX() - origin[0];
                        float totalDy = event.getRawY() - origin[1];
                        if (Math.hypot(totalDx, totalDy) > touchSlop) {
                            dragged[0] = true;
                        }
                        // Clamp inside the screen: the bubble lands exactly
                        // where the finger leaves it and STAYS there.
                        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                        params.x = Math.max(4, Math.min(params.x, dm.widthPixels - dp(66)));
                        params.y = Math.max(4, Math.min(params.y, dm.heightPixels - dp(66)));
                        try {
                            wm.updateViewLayout(container, params);
                        } catch (Exception ignored) {
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        long held = System.currentTimeMillis() - downAt[0];
                        if (dragged[0]) {
                            // A DRAG — any duration, any speed — just moves
                            // the bubble. It rests where dropped. Never
                            // dismisses, never expands.
                        } else if (held > 600) {
                            // Long-press (finger held still) dismisses.
                            stopSelf();
                        } else {
                            // TAP = expand the trade-log card IN PLACE, over
                            // whatever app is in front. Never re-open the app.
                            toggleExpanded();
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        // A system steal (notification shade, home gesture)
                        // ends the gesture like a drop — no dismissal.
                        return true;
                    default:
                        return false;
                }
            }
        });

        try {
            wm.addView(container, params);
        } catch (Exception e) {
            // No overlay permission after all, or the OEM blocked the window:
            // never crash — just don't show the bubble.
            android.util.Log.e("EAMIGRATE", "bubble addView failed: " + e);
            stopSelf();
            return;
        }
        bubble = container;
    }

    /** Tap bubble → show the expanded trade-log card; ✕ on the card closes it. */
    private void toggleExpanded() {
        if (expanded == null) {
            expandCard();
        }
        // While expanded the bubble is hidden, and the card NEVER folds on a
        // tap — only the ✕ zone closes it (the owner wants it to stay showing).
    }

    /**
     * The expanded trade-log card — the SAME layout as the in-app popup:
     * EA picture header with the robot name + green "SERVER CONNECTED" dot,
     * a dark terminal panel streaming the trade log, and a ✕ that folds it
     * back into the bubble. Shown via TYPE_APPLICATION_OVERLAY so it floats
     * above MetaTrader; the trader NEVER leaves their app.
     */
    private void expandCard() {
        if (expanded != null || wm == null) return;
        try {
            final int width = dp(300);
            final int headerH = dp(170);
            final int logH = dp(120);

            final LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable cardBg = new GradientDrawable();
            cardBg.setCornerRadius(dp(18));
            cardBg.setColor(Color.parseColor("#0A0A1A"));
            cardBg.setStroke(dp(2), Color.parseColor("#A020F0"));
            card.setBackground(cardBg);
            // Subtle red band on the card header bottom edge.
            View redBand = new View(this);
            redBand.setBackground(new GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[] { Color.parseColor("#E11D48"), Color.parseColor("#0A0F1E") }));
            redBand.setLayoutParams(new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, dp(3)));
            header.addView(redBand);
            card.setClipToOutline(true);

            // ── Header: EA picture + name + status ──
            final FrameLayout header = new FrameLayout(this);
            header.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, headerH));

            final ImageView hero = new ImageView(this);
            hero.setScaleType(ImageView.ScaleType.CENTER_CROP);
            hero.setLayoutParams(new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            header.addView(hero);
            loadBitmapInto(hero);

            // Bottom scrim so the name stays readable.
            View scrim = new View(this);
            scrim.setBackground(new GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[] { Color.TRANSPARENT, Color.parseColor("#CC000000") }));
            scrim.setLayoutParams(new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, headerH / 2, Gravity.BOTTOM));
            header.addView(scrim);

            // ✕ close — folds back into the bubble.
            final TextView close = new TextView(this);
            close.setText("✕");
            close.setTextSize(14f);
            close.setTextColor(Color.WHITE);
            close.setGravity(Gravity.CENTER);
            GradientDrawable closeBg = new GradientDrawable();
            closeBg.setShape(GradientDrawable.OVAL);
            closeBg.setColor(Color.parseColor("#99000000"));
            close.setBackground(closeBg);
            FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(28), dp(28),
                    Gravity.TOP | Gravity.END);
            closeParams.setMargins(0, dp(10), dp(10), 0);
            close.setLayoutParams(closeParams);
            header.addView(close);

            LinearLayout info = new LinearLayout(this);
            info.setOrientation(LinearLayout.VERTICAL);
            FrameLayout.LayoutParams infoParams = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM | Gravity.START);
            infoParams.setMargins(dp(14), 0, 0, dp(10));
            info.setLayoutParams(infoParams);

            TextView name = new TextView(this);
            name.setText(eaName);
            name.setTextSize(17f);
            name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            name.setTextColor(Color.WHITE);
            name.setSingleLine(true);
            name.setEllipsize(TextUtils.TruncateAt.END);
            name.setMaxWidth(width - dp(60));
            info.addView(name);

            LinearLayout statusRow = new LinearLayout(this);
            statusRow.setOrientation(LinearLayout.HORIZONTAL);
            statusRow.setGravity(Gravity.CENTER_VERTICAL);
            View statusDot = new View(this);
            LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(9), dp(9));
            dotLp.setMargins(0, 0, dp(6), 0);
            statusDot.setLayoutParams(dotLp);
            GradientDrawable dotBg = new GradientDrawable();
            dotBg.setShape(GradientDrawable.OVAL);
            dotBg.setColor(Color.parseColor("#22C55E"));
            statusDot.setBackground(dotBg);
            statusRow.addView(statusDot);
            TextView status = new TextView(this);
            status.setText("SERVER CONNECTED");
            status.setTextSize(10f);
            status.setLetterSpacing(0.12f);
            status.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            status.setTextColor(Color.parseColor("#4ADE80"));
            statusRow.addView(status);
            info.addView(statusRow);
            // Amber status detail under the green SERVER CONNECTED label.
            TextView statusDetail = new TextView(this);
            statusDetail.setText("Trade bot active");
            statusDetail.setTextSize(10f);
            statusDetail.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            statusDetail.setTextColor(Color.parseColor("#F97316"));
            statusDetail.setSingleLine(true);
            statusDetail.setEllipsize(TextUtils.TruncateAt.END);
            statusDetail.setMaxWidth(width - dp(60));
            info.addView(statusDetail);

            header.addView(info);
            card.addView(header);

            // ── Terminal log panel ──
            expandedLogList = new LinearLayout(this);
            expandedLogList.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams logListParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, logH);
            expandedLogList.setLayoutParams(logListParams);
            expandedLogList.setPadding(dp(14), dp(8), dp(14), dp(8));
            expandedLogList.setBackgroundColor(Color.parseColor("#0F172A"));
            // Red-tinted card footer line.
            View footerLine = new View(this);
            footerLine.setBackground(new GradientDrawable(
                    GradientDrawable.Orientation.Bottom_TOP,
                    new int[] { Color.parseColor("#0F172A"), Color.parseColor("#1E1018") }));
            footerLine.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(1)));
            expandedLogList.addView(footerLine);
            rebuildExpandedLog();
            card.addView(expandedLogList);

            final WindowManager.LayoutParams cardParams = new WindowManager.LayoutParams(
                    width,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.TRANSLUCENT);
            cardParams.gravity = Gravity.TOP | Gravity.END;
            cardParams.x = dp(10);
            cardParams.y = dp(120);

            wm.addView(card, cardParams);
            expanded = card;
            // While expanded, the round bubble hides — the card takes over.
            if (bubble != null) {
                bubble.setVisibility(View.GONE);
            }

            // ── CARD GESTURES: drag it anywhere, tap does NOT close it. ──
            // The card consumes every touch itself (so the ✕ zone and the
            // drag are handled here — the child views never see the events).
            //   • DRAG (any speed) → the card moves and rests where dropped.
            //   • TAP on the ✕ zone (top-right corner) → folds back to the
            //     bubble — the ONLY way to close it.
            //   • TAP anywhere else → intentionally nothing: the card STAYS.
            final float[] cardOrigin = new float[2];
            final float[] cardLast = new float[2];
            final boolean[] cardDragged = new boolean[1];
            final int cardSlop = dp(8);
            card.setOnTouchListener(new View.OnTouchListener() {
                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    switch (event.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN:
                            cardOrigin[0] = event.getRawX();
                            cardOrigin[1] = event.getRawY();
                            cardLast[0] = cardOrigin[0];
                            cardLast[1] = cardOrigin[1];
                            cardDragged[0] = false;
                            return true;
                        case MotionEvent.ACTION_MOVE: {
                            float dx = event.getRawX() - cardLast[0];
                            float dy = event.getRawY() - cardLast[1];
                            cardLast[0] = event.getRawX();
                            cardLast[1] = event.getRawY();
                            cardParams.x += (int) dx;
                            cardParams.y += (int) dy;
                            if (Math.hypot(event.getRawX() - cardOrigin[0], event.getRawY() - cardOrigin[1]) > cardSlop) {
                                cardDragged[0] = true;
                            }
                            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                            cardParams.x = Math.max(4, Math.min(cardParams.x, dm.widthPixels - width));
                            cardParams.y = Math.max(4, Math.min(cardParams.y, dm.heightPixels - dp(120)));
                            try {
                                wm.updateViewLayout(card, cardParams);
                            } catch (Exception ignored) {
                            }
                            return true;
                        }
                        case MotionEvent.ACTION_UP: {
                            if (!cardDragged[0]) {
                                int[] location = new int[2];
                                v.getLocationOnScreen(location);
                                float tapX = event.getRawX() - location[0];
                                float tapY = event.getRawY() - location[1];
                                if (tapX >= width - dp(46) && tapY <= dp(46)) {
                                    collapseExpanded();
                                }
                                // Any other tap: the card stays exactly as it is.
                            }
                            return true;
                        }
                        case MotionEvent.ACTION_CANCEL:
                            return true;
                        default:
                            return false;
                    }
                }
            });
        } catch (Exception e) {
            android.util.Log.e("EAMIGRATE", "expand card failed: " + e);
            expanded = null;
            expandedLogList = null;
        }
    }

    /** Fold the card away and bring the round bubble back. */
    private void collapseExpanded() {
        try {
            if (expanded != null && wm != null) {
                wm.removeView(expanded);
            }
        } catch (Exception ignored) {
        }
        expanded = null;
        expandedLogList = null;
        if (bubble != null) {
            bubble.setVisibility(View.VISIBLE);
        }
    }

    /**
     * Load the EA picture into any ImageView — base64 data URLs (the portal
     * stores images that way) are decoded directly; http(s) URLs stream.
     */
    private void loadBitmapInto(final ImageView target) {
        loadInto(target, false);
    }

    private void loadBitmap(final ImageView target) {
        loadInto(target, true);
    }

    /**
     * Decode off the main thread and ALWAYS hand the view something: the
     * bot's picture, or the app icon.
     *
     * The old version caught Exception only. A large picture ran the worker
     * out of memory, and OutOfMemoryError is an Error — it sailed past the
     * catch, killed the thread before anything was posted, and left a
     * permanently EMPTY circle: the bot image simply never appeared. Every
     * failure now ends in the fallback.
     */
    private void loadInto(final ImageView target, final boolean round) {
        final String source = imageUrl;
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap ready = null;
                try {
                    Bitmap raw = decodeImage(source);
                    if (raw != null) {
                        ready = round ? circular(raw) : raw;
                    }
                } catch (Throwable t) {
                    android.util.Log.e("EAMIGRATE", "bubble image failed: " + t);
                }
                final Bitmap result = ready;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        if (result != null) {
                            target.setImageBitmap(result);
                        } else {
                            target.setImageResource(R.drawable.ic_launcher);
                        }
                    }
                });
            }
        }).start();
    }

    /**
     * Decode the EA image from any form the web app can send:
     *   • "data:image/png;base64,AAAA…" → the base64 payload is decoded here,
     *   • "https://…" → streamed over the network,
     *   • "/logo.png" → a SITE-RELATIVE path. The browser resolves it against
     *     the origin, this class could not, and the app's own default bot
     *     picture is exactly that — so the bubble quietly showed the app icon
     *     instead of the robot. Resolved against the platform host.
     *
     * Bitmap dimensions are sampled down to at most MAX_DIMENSION: a
     * full-resolution decode of a modern phone photo is tens of megabytes.
     *
     * Returns null instead of throwing for anything unreadable — including
     * OutOfMemoryError — so the caller always reaches its fallback.
     */
    private static Bitmap decodeImage(String src) {
        if (src == null || src.isEmpty()) return null;
        try {
            String source = resolveSource(src);
            if (source == null) return null;
            byte[] bytes;
            if (source.startsWith("data:image")) {
                int comma = source.indexOf(',');
                String payload = comma >= 0 ? source.substring(comma + 1) : source;
                bytes = Base64.decode(payload, Base64.DEFAULT);
            } else {
                HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setInstanceFollowRedirects(true);
                InputStream in = connection.getInputStream();
                bytes = readAll(in);
                in.close();
            }
            return decodeSampled(bytes);
        } catch (Throwable t) {
            android.util.Log.e("EAMIGRATE", "image decode failed: " + t);
            return null;
        }
    }

    /** Turn a web reference into something this class can fetch, or null. */
    private static String resolveSource(String src) {
        String value = src.trim();
        if (value.startsWith("data:image")) return value;
        if (value.startsWith("http://") || value.startsWith("https://")) return value;
        // A blob: URL lives inside the WebView's own storage and cannot be
        // opened from here — the web app converts those to a data URL first.
        if (value.startsWith("blob:")) return null;
        if (value.startsWith("/")) return SITE_ORIGIN + value;
        return null;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) != -1) {
            out.write(chunk, 0, read);
        }
        return out.toByteArray();
    }

    /** Decode, downsampled so a huge picture never exhausts the heap. */
    private static Bitmap decodeSampled(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

        int sample = 1;
        int largest = Math.max(bounds.outWidth, bounds.outHeight);
        while (largest > 0 && largest / sample > MAX_DIMENSION) {
            sample *= 2;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private static Bitmap circular(Bitmap src) {
        if (src == null) {
            return null;
        }
        int size = Math.min(src.getWidth(), src.getHeight());
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        return out;
    }

    @Override
    public void onDestroy() {
        try {
            if (expanded != null && wm != null) {
                wm.removeView(expanded);
            }
            if (bubble != null) {
                wm.removeView(bubble);
            }
        } catch (Exception ignored) {
            // window already gone — nothing to clean up
        }
        expanded = null;
        expandedLogList = null;
        bubble = null;
        instance = null;
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
