package pro.eamigrate.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Rational;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;

/**
 * EA Migrate Android wrapper — a fast, full-screen WebView over the live
 * platform. Opens straight into the APP experience (/app).
 *
 * Reliability hardening:
 *  - LOAD_NO_CACHE: never serves a stale bundle from the HTTP cache — the
 *    "app won't load after a deploy" class of bug dies here.
 *  - MIXED_CONTENT_COMPATIBILITY + safe browsing defaults: the platform is
 *    HTTPS, but embedded broker/feed resources are not always.
 *  - window.EAMigrate.reportError(msg): every JS crash inside the page is
 *    forwarded to logcat with an "EAMIGRATE" tag — `adb logcat -s EAMIGRATE`
 *    shows the real error instead of a black screen. The page also shows the
 *    message in its own error UI.
 *
 * Floating bot bubble: while a bot runs, the web app calls
 * EAMigrate.showBubble(imageUrl) — a round chat-head avatar that floats
 * above EVERY app (MetaTrader included), draggable, tap to return,
 * long-press to dismiss. OverlayService.push(line) streams the latest
 * trade-log line into it. Picture-in-Picture remains available too.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://eamigratepro.vercel.app/app";
    private static final int FILE_CHOOSER_REQUEST = 4242;
    private WebView web;
    private boolean autoPip = false;
    private ValueCallback<Uri[]> fileChooserCallback;
    /** Bot image remembered while the overlay permission was missing — launched on return. */
    private String pendingBubbleImage;

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
        // Never serve a stale cached bundle: every load hits the network
        // (static assets are immutable-hashed, so this costs nothing).
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // WebGL/derivative content used by chart views.
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Modern default; avoids SafeBrowsing interstitials on some
            // carriers for the embedded feed hosts.
            settings.setSafeBrowsingEnabled(true);
        }
        web.setBackgroundColor(Color.parseColor("#07090b"));
        web.addJavascriptInterface(new Bridge(), "EAMigrate");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                // Surface page errors to logcat so a black screen is never
                // undiagnosable: adb logcat -s EAMIGRATE
                // NOTE: message.sourceLocation() does not exist in newer
                // build-tools (it broke the CI build) — messageLevel() only.
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.e("EAMIGRATE", "JS: " + message.message());
                }
                return true;
            }

            /**
             * File chooser — WITHOUT this the scanner's "attach screenshot"
             * button did nothing on the phone: the HTML <input type=file>
             * never opened Android's picker. NO FLAG_ACTIVITY_NEW_TASK: it
             * makes Android cancel the chooser immediately (null result
             * before the user picks anything). A stale pending callback is
             * cancelled first so a second pick never dead-ends.
             */
            @Override
            public boolean onShowFileChooser(WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                    fileChooserCallback = null;
                }
                fileChooserCallback = filePathCallback;
                try {
                    Intent picker = fileChooserParams.createIntent();
                    startActivityForResult(picker, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
                return true;
            }

            /** confirm()/alert() from the page — suppressed by default, so
             *  the portal's delete button appeared completely dead. */
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setNegativeButton("Cancel", (d, w) -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .show();
                return true;
            }
        });
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

        /**
         * Opens the system "Display over other apps" screen for THIS app.
         * The web app calls it when the user tries to float the bot and the
         * permission is missing — without it the chat-head bubble can never
         * appear over MetaTrader or any other app.
         */
        @JavascriptInterface
        public void requestOverlayPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || overlayAllowed()) return;
                    try {
                        Intent intent = new Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        android.widget.Toast.makeText(
                                MainActivity.this,
                                "Allow \"Display over other apps\" for EA Migrate, then come back",
                                android.widget.Toast.LENGTH_LONG).show();
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** Runtime error reporting from the page — visible via adb logcat. */
        @JavascriptInterface
        public void reportError(final String message) {
            android.util.Log.e("EAMIGRATE", "REPORTED: " + message);
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void showBubble(final String imageUrl, final String name) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                            || Settings.canDrawOverlays(MainActivity.this);
                    if (!allowed) {
                        // AUTO-PROMPT: pressing Start with the permission missing
                        // jumps straight into the system "Display over other apps"
                        // screen for THIS app. When the user returns having granted
                        // it, onResume launches the bubble they asked for — no
                        // second Start press needed.
                        pendingBubbleImage = imageUrl;
                        try {
                            Intent intent = new Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                            android.widget.Toast.makeText(
                                    MainActivity.this,
                                    "Allow \"Display over other apps\" — the bot bubble appears when you come back",
                                    android.widget.Toast.LENGTH_LONG).show();
                        } catch (Exception ignored) {
                        }
                        return;
                    }
                    startBubbleService(imageUrl, name);
                }
            });
        }

        @JavascriptInterface
        public void hideBubble() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingBubbleImage = null;
                    Intent intent = new Intent(MainActivity.this, OverlayService.class);
                    intent.putExtra("stop", true);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent); // the service promotes, then stops — never a "did not call startForeground" crash
                    } else {
                        startService(intent);
                    }
                }
            });
        }

        @JavascriptInterface
        public void pushLog(final String line) {
            OverlayService.push(line);
        }
    }

    /**
     * Launch the floating chat-head service. Oreo+ uses startForegroundService
     * so the process survives MetaTrader and other heavy apps in front.
     * The EA name rides along — the bubble's expanded popup shows it.
     */
    private void startBubbleService(String image, String name) {
        Intent intent = new Intent(MainActivity.this, OverlayService.class);
        intent.putExtra("image", image);
        if (name != null && !name.trim().isEmpty()) {
            intent.putExtra("name", name.trim());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Returning from the overlay-permission screen: if a bubble was
        // requested while the permission was missing and it is granted now,
        // launch it immediately — the bot floats without pressing Start again.
        if (pendingBubbleImage != null && overlayAllowed()) {
            startBubbleService(pendingBubbleImage, null);
            pendingBubbleImage = null;
            android.widget.Toast.makeText(this,
                    "Bot bubble floating over other apps ✓",
                    android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (autoPip && pipSupported()) {
            enterPipMode();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPipMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPipMode, newConfig);
        web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('eamigrate:pip',{detail:{active:" + isInPipMode + "}}))", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            // Deliver the picked file(s) back to the page (null = cancelled).
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                results = pickedFileUris(data);
            }
            fileChooserCallback.onReceiveValue(results);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * Every picked file as a READABLE content:// URI. Different OEM pickers
     * return different extras — some fill getData(), the multi-select ones
     * CLIP_DATA, and Samsung's document provider returns getClipData() even
     * for a single pick. Reading only getData() made the scanner's screenshot
     * upload silently fail on those phones: the picker closed, the page
     * received null, nothing appeared. The URIs are also forced through
     * takePersistableUriPermission where the provider allows it so the
     * WebView's pipeline can still read them after the picker is gone.
     */
    private Uri[] pickedFileUris(Intent data) {
        java.util.ArrayList<Uri> uris = new java.util.ArrayList<>();
        if (data.getClipData() != null) {
            android.content.ClipDescription description = data.getClipData().getDescription();
            for (int index = 0; index < data.getClipData().getItemCount(); index++) {
                Uri uri = data.getClipData().getItemAt(index).getUri();
                if (uri != null) {
                    grantReadPermission(uri, description);
                    uris.add(uri);
                }
            }
        }
        if (uris.isEmpty() && data.getData() != null) {
            grantReadPermission(data.getData(), null);
            uris.add(data.getData());
        }
        return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
    }

    private void grantReadPermission(Uri uri, android.content.ClipDescription description) {
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Provider does not offer persistable grants — the transient
            // read grant from the picker is enough.
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
