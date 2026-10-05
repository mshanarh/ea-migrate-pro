package pro.eamigrate.app;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
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
import android.webkit.WebResourceRequest;
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

    /**
     * Request code for the Android 13+ notification permission. Distinct from
     * FILE_CHOOSER_REQUEST so the two answers can never be confused in
     * onRequestPermissionsResult.
     */
    private static final int NOTIFICATION_PERMISSION_REQUEST = 9001;

    /**
     * The trade-alert channel, registered here as well as in OverlayService.
     *
     * WHY IT IS REGISTERED TWICE. A notification channel only becomes visible
     * and configurable in system settings once it has been CREATED, and it is
     * only ever created by the process that calls createNotificationChannel().
     * OverlayService creates it — but that service only runs while the floating
     * bot bubble is alive, so a trade alert fired with the bubble stopped could
     * otherwise have nowhere to post. Creating the channel in the Activity
     * means it exists from the moment the app opens, bubble or no bubble.
     *
     * The id, name, description and IMPORTANCE must stay identical to
     * OverlayService's copy: createNotificationChannel() is idempotent on id, so
     * a second call with different importance settings does NOT reconfigure an
     * existing channel — it is silently ignored, and the two copies drifting
     * apart would be invisible until a user's alerts quietly stopped buzzing.
     */
    private static final String TRADE_CHANNEL_ID = "eamigrate_trade_executed";
    private static final String TRADE_CHANNEL_NAME = "Trade executed";

    /** Create the trade-alert channel so Android recognises it immediately. */
    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;
            if (manager.getNotificationChannel(TRADE_CHANNEL_ID) != null) return; // already right
            NotificationChannel channel = new NotificationChannel(
                    TRADE_CHANNEL_ID,
                    TRADE_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH); // HIGH — a fill must be seen now
            channel.setDescription("Alerts the user when EA Migrate fills a trade");
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setShowBadge(true);
            channel.setLightColor(Color.parseColor("#E11D48"));
            manager.createNotificationChannel(channel);
        } catch (Throwable t) {
            // A missing channel costs the heads-up, never the launch.
            android.util.Log.e("EAMIGRATE", "notification channel setup failed: " + t);
        }
    }

    /**
     * Ask for POST_NOTIFICATIONS on Android 13+.
     *
     * On API 33+ the permission is RUNTIME, so declaring it in the manifest
     * (which is now done) is only half the job: until the user grants it,
     * every NotificationManager.notify() call is dropped without an error. The
     * request is made once per launch and only when it is actually missing, so
     * a granted user is never nagged.
     *
     * NOT called before super.onCreate() and NOT re-asked on every resume:
     * Android ignores a second prompt after a denial, so hammering it would
     * achieve nothing. openNotificationSettings() is the way back for a user
     * who said no once — see the bridge method of the same name.
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return; // granted at install below 13
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            requestPermissions(
                    new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST);
        } catch (Throwable t) {
            android.util.Log.e("EAMIGRATE", "notification permission request failed: " + t);
        }
    }

    /** True when this app may post notifications. Always true below Android 13. */
    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }
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

    /** The origin this app owns. Everything else is somebody else's website. */
    private static final String APP_ORIGIN = "https://eamigratepro.vercel.app";

    /**
     * true when the URL left our own site and was handed to the system
     * browser; false when the WebView should load it itself.
     *
     * Covers the Whop checkout hop, mailto: links and any other outbound tap.
     * Returning false for our own origin is what keeps the SPA working —
     * client-side routing fires through here too.
     */
    private boolean openExternally(String url) {
        if (url == null) return false;
        if (url.startsWith(APP_ORIGIN) || url.startsWith("about:") || url.startsWith("data:")) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception error) {
            // No browser installed, or the chooser refused. Load it in the
            // WebView rather than dead-ending the customer on a blank screen.
            web.loadUrl(url);
            return true;
        }
        return true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Trade alerts must work from the first fill, whether or not the floating
        // bubble happens to be running: register the channel, then ask for the
        // permission Android 13+ requires. Both are cheap and neither can throw
        // — they are guarded internally and never block the WebView loading.
        ensureNotificationChannels();
        requestNotificationPermissionIfNeeded();
        // Publish the application context for trade alerts. The bubble service is
        // NOT guaranteed to be running when a trade fires — it is not even
        // started at all unless the user turned it on — so the alerts resolve
        // their NotificationManager from here, where the context always exists.
        OverlayService.setNotificationContext(this);
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
        web.setBackgroundColor(Color.parseColor("#0A0F1E"));
        // Theme palette — keep the dark base, make red the primary contact color.
        static final int THEME_RED = Color.parseColor("#E11D48");
        static final int THEME_AMBER = Color.parseColor("#F97316");
        static final int THEME_GREEN = Color.parseColor("#22C55E");
        web.addJavascriptInterface(new Bridge(), "EAMigrate");
        // EXTERNAL LINKS LEAVE THE APP. The payment redirect is a plain
        // location.replace() to whop.com, and a WebView that tries to render
        // a payment page of its own accord is how "it redirects and then
        // nothing happens" happened on Android: the checkout never opened
        // anywhere the customer could see or pay from. Anything outside our
        // own origin is handed to the system browser instead, which is also
        // what the user expects when they tap a payment link.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternally(url);
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl() != null ? request.getUrl().toString() : null);
            }
        });
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
        public int[] getThemeColors() {
            return new int[] {
                THEME_RED, THEME_AMBER, THEME_GREEN, THEME_RED, THEME_AMBER, THEME_GREEN
            };
        }

        @JavascriptInterface
        public int getThemeRed() {
            return THEME_RED;
        }

        @JavascriptInterface
        public int getThemeAmber() {
            return THEME_AMBER;
        }

        @JavascriptInterface
        public int getThemeGreen() {
            return THEME_GREEN;
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

        /**
         * Push a foreground trade-execution notification to the phone when
         * the robot has just filled a trade. Red = loss, amber = pending,
         * green = win — the same Algohost palette the web theme uses.
         */
        @JavascriptInterface
        public void showTradeNotification(final String eaName, final String text) {
            try {
                OverlayService.showTradeNotification(eaName, text);
            } catch (Throwable t) {
                android.util.Log.e("EAMIGRATE", "showTradeNotification bridge failed: " + t);
            }
        }

        /**
         * May this app post notifications right now? The web app asks before it
         * promises the user an alert, so a blocked permission shows an honest
         * "turn on notifications" path instead of silently doing nothing.
         */
        @JavascriptInterface
        public boolean canPostNotifications() {
            return notificationsAllowed();
        }

        /**
         * Open this app's notification settings directly.
         *
         * NEEDED because a runtime denial is effectively sticky: once the user
         * has dismissed the Android 13+ prompt, the system will not ask again,
         * so calling requestPermissions() a second time is a silent no-op and
         * the app can never recover on its own. The only route back is the
         * settings screen, which is what this opens — scoped to THIS package, so
         * the user lands on EA Migrate's own toggle and not a list of apps.
         */
        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        android.widget.Toast.makeText(
                                MainActivity.this,
                                "Turn on notifications for EA Migrate, then come back",
                                android.widget.Toast.LENGTH_LONG).show();
                    } catch (Throwable t) {
                        android.util.Log.e("EAMIGRATE", "could not open notification settings: " + t);
                        android.widget.Toast.makeText(
                                MainActivity.this,
                                "Open Settings \u2192 Apps \u2192 EA Migrate \u2192 Notifications",
                                android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            });
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
