package pro.eamigrate.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * EA Migrate Android wrapper — a fast, full-screen WebView over the live
 * platform. Opens straight into the APP experience (/app) — never the
 * marketing landing page. Sign-in state persists in the WebView storage,
 * so after the first login the app opens directly into the workspace.
 *
 * Picture-in-Picture: the web app calls EAMigrate.enterPip() (the 📺 button
 * on the bot popup) to float the trade log ABOVE other apps — MetaTrader
 * included. With auto-PiP enabled (set while a bot is running), simply
 * leaving the app shrinks it to the floating window automatically.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://eamigratepro.vercel.app/app";
    private WebView web;
    private boolean autoPip = false;

    private boolean pipSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
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
    }

    /** Leaving the app while a bot runs → shrink to the floating window. */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (autoPip && pipSupported() && !isInPictureInPictureMode()) {
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
