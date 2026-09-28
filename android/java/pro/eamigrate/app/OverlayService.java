package pro.eamigrate.app;

import android.app.Service;
import android.content.Intent;
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
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Chat-head style floating bot bubble — a round bot avatar that FLOATS
 * above every app (MetaTrader included), draggable anywhere. Tap re-opens
 * the EA Migrate app; long-press dismisses the bubble. The web app pushes
 * the latest trade-log line via OverlayService.push(line) so the bubble
 * always shows what the bot is doing right now.
 */
public class OverlayService extends Service {
    private static OverlayService instance;

    private WindowManager wm;
    private View bubble;
    private TextView logLine;
    private String lastLine = "";
    private String imageUrl;

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
        if (intent != null && intent.getBooleanExtra("stop", false)) {
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
        show();
        return START_STICKY;
    }

    private void setLine(final String line) {
        lastLine = line == null ? "" : line;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                if (logLine != null) {
                    String text = lastLine.length() > 36 ? lastLine.substring(0, 36) + "…" : lastLine;
                    logLine.setText(text);
                }
            }
        });
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
                            down[0] = event.getRawX();
                            down[1] = event.getRawY();
                            wm.updateViewLayout(container, params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        long held = System.currentTimeMillis() - downAt[0];
                        if (held > 600) {
                            stopSelf(); // long-press dismisses the bubble
                        } else if (!moved[0]) {
                            Intent open = new Intent(OverlayService.this, MainActivity.class);
                            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                            startActivity(open); // tap jumps back into the app
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });

        wm.addView(container, params);
        bubble = container;
    }

    private void loadBitmap(final ImageView target) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap rounded = null;
                try {
                    String src = imageUrl != null && imageUrl.startsWith("http")
                            ? imageUrl
                            : "https://eamigratepro.vercel.app/logo.png";
                    HttpURLConnection connection = (HttpURLConnection) new URL(src).openConnection();
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(8000);
                    InputStream in = connection.getInputStream();
                    Bitmap raw = BitmapFactory.decodeStream(in);
                    in.close();
                    rounded = circular(raw);
                } catch (Exception ignored) {
                    // network hiccup — the app icon below still shows
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
        if (bubble != null) {
            wm.removeView(bubble);
            bubble = null;
        }
        instance = null;
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
