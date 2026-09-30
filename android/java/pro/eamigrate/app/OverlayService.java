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

        final float[] down = new float[2];
        final boolean[] moved = new boolean[1];
        final long[] downAt = new long[1];
        container.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        down[0] = event.getRawX();
                        down[1] = event.getRawY();
                        moved[0] = false;
                        downAt[0] = System.currentTimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - down[0];
                        float dy = event.getRawY() - down[1];
                        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                            moved[0] = true;
                            params.x += (int) dx;
                            params.y += (int) dy;
                            try {
                                wm.updateViewLayout(container, params);
                            } catch (Exception ignored) {
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        long held = System.currentTimeMillis() - downAt[0];
                        if (held > 600) {
                            stopSelf(); // long-press dismisses the bubble
                        } else if (!moved[0]) {
                            // TAP = expand the trade-log card IN PLACE, over
                            // whatever app is in front. Never re-open the app —
                            // that used to yank the trader out of MetaTrader.
                            toggleExpanded();
                        }
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

    /** Tap bubble → show the expanded trade-log card; ✕ → back to bubble. */
    private void toggleExpanded() {
        if (expanded != null) {
            collapseExpanded();
        } else {
            expandCard();
        }
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
            close.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    collapseExpanded();
                }
            });
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
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap rounded = null;
                try {
                    rounded = decodeImage(imageUrl);
                } catch (Exception ignored) {
                    // network hiccup / bad data — the app icon below still shows
                }
                final Bitmap result = rounded;
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

    private void loadBitmap(final ImageView target) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap rounded = null;
                try {
                    Bitmap raw = decodeImage(imageUrl);
                    if (raw != null) {
                        rounded = circular(raw);
                    }
                } catch (Exception ignored) {
                }
                final Bitmap result = rounded;
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
     * Decode the EA image from EITHER form the web app sends:
     *   • "data:image/png;base64,AAAA…" → decode the base64 payload directly
     *     (this is how portal-uploaded EA pictures travel — before v1.8 only
     *     http(s) URLs were handled, so the bubble always fell back to the
     *     platform logo),
     *   • "https://…" → streamed over the network.
     */
    private static Bitmap decodeImage(String src) {
        if (src == null || src.isEmpty()) return null;
        try {
            if (src.startsWith("data:image")) {
                int comma = src.indexOf(',');
                String payload = comma >= 0 ? src.substring(comma + 1) : src;
                byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            }
            if (src.startsWith("http")) {
                HttpURLConnection connection = (HttpURLConnection) new URL(src).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                InputStream in = connection.getInputStream();
                Bitmap raw = BitmapFactory.decodeStream(in);
                in.close();
                return raw;
            }
        } catch (Exception e) {
            android.util.Log.e("EAMIGRATE", "image decode failed: " + e.getMessage());
        }
        return null;
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
