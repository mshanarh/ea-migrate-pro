package pro.eamigrate.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Rational;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * EA Migrate Android wrapper — a fast, full-screen WebView over the live
 * platform. Opens straight into the APP experience (/app).
 *
 * Floating bot bubble: while a bot runs, the web app calls
 * EAMigrate.showBubble(imageUrl) — a round chat-head avatar that floats
 * above EVERY app (MetaTrader included), draggable, tap to return,
 * long-press to dismiss. OverlayService.push(line) streams the latest
 * trade-log line into it. Picture-in-Picture remains available too.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://eamigratepro.vercel.app/app";
    private WebView web;
    private boolean autoPip = false;

    private boolean pipSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
    }

    private boolean overlayAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(this);
    }

    private void enterPipMode() {
        if (!pipSupported()) return;
        PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(3, 4))
                .build();
        enterPictureInPictureMode(params);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "EAMigrate");
        web.setWebViewClient(new WebViewClient());
        web.loadUrl(START_URL);
        setContentView(web);
    }

    /** Exposed to the web app as window.EAMigrate. */
    private class Bridge {
        @JavascriptInterface
        public boolean canPip() {
            return pipSupported();
        }

        @JavascriptInterface
        public void enterPip() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    enterPipMode();
                }
            });
        }

        @JavascriptInterface
        public void setAutoPip(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    autoPip = on;
                }
            });
        }

        @JavascriptInterface
        public boolean canOverlay() {
            return overlayAllowed();
        }

        /** Opens the system "Display over other apps" settings page. */
        @JavascriptInterface
        public void requestOverlay() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                }
            });
        }

        @JavascriptInterface
        public void showBubble(final String imageUrl) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!overlayAllowed()) {
                        requestOverlay();
                        return;
                    }
                    Intent intent = new Intent(MainActivity.this, OverlayService.class);
                    intent.putExtra("image", imageUrl);
                    startService(intent);
                }
            });
        }

        @JavascriptInterface
        public void hideBubble() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(MainActivity.this, OverlayService.class);
                    intent.putExtra("stop", true);
                    startService(intent);
                }
            });
        }

        @JavascriptInterface
        public void pushLog(final String line) {
            OverlayService.push(line);
        }
    }

    /** Leaving the app while a bot runs → shrink to the floating window. */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (autoPip && pipSupported() && !isInPictureInPictureMode() && !overlayAllowed()) {
            enterPipMode();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPip, newConfig);
        if (web != null) {
            String js = "document.documentElement.classList." + (isInPip ? "add" : "remove")
                    + "('pip-active');"
                    + "window.dispatchEvent(new Event('" + (isInPip ? "eamigrate:pip-enter" : "eamigrate:pip-exit") + "'));";
            web.evaluateJavascript(js, null);
        }
    }

    @Override
    public void onBackPressed() {
        if (isInPictureInPictureMode()) {
            finish();
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        }
    }
}
