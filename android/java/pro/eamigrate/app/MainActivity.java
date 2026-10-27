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
import android.speech.tts.TextToSpeech;
import java.util.Locale;

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
    /** Analysed signal remembered while the overlay permission was missing. */
    private String pendingAnalysis;

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

    /** Theme palette — keep the dark base, make red the primary contact colour. */
    private static final int THEME_RED = Color.parseColor("#E11D48");
    private static final int THEME_AMBER = Color.parseColor("#F97316");
    private static final int THEME_GREEN = Color.parseColor("#22C55E");

    /** Native speech — the WebView's own speechSynthesis is silent on Android. */
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    /**
     * The last line that arrived before the engine reported ready. Android's
     * TTS init is asynchronous, so the FIRST announcement of a run (the
     * welcome, or the first fill after a cold start) used to be dropped with
     * no trace — the app "played sounds but never spoke". It is held here and
     * spoken the moment OnInit succeeds.
     */
    private volatile String pendingSpeech = null;
    private volatile float pendingVolume = 1.0f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Native TextToSpeech up front: every announcement (welcome, trade
        // plans, counts) goes through window.EAMigrate.speak → this engine,
        // because the WebView's speechSynthesis never speaks on Android.
        // Initialising here — not on the first utterance — means the engine
        // is ready by the time the page says anything.
        ensureTts();
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
        web.addJavascriptInterface(new Bridge(), "EAMigrate");
        // EXECUTE ON THE NATIVE CARD COMES BACK HERE.
        //
        // The floating AI TRADE ANALYSIS card is a native window, so its
        // Execute button cannot run the app's trading code by itself. Tapping
        // it dispatches an event into the page instead; the web app — which
        // owns the saved MT5 account, the risk checks and the bridge call —
        // then places the order exactly as if the card were in-app. The native
        // side therefore NEVER fabricates a fill.
        OverlayService.setAnalysisActionListener(new OverlayService.AnalysisActionListener() {
            @Override
            public void onExecute(final String signalJson) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        String payload = signalJson == null || signalJson.trim().isEmpty()
                                ? "{}"
                                : signalJson;
                        try {
                            web.evaluateJavascript(
                                    "window.dispatchEvent(new CustomEvent('eamp:native-execute',{detail:"
                                            + payload + "}));",
                                    null);
                        } catch (Throwable t) {
                            android.util.Log.e("EAMIGRATE", "native execute hand-off failed: " + t);
                        }
                    }
                });
            }
        });
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
         * Float the AI TRADE ANALYSIS card over every app (MetaTrader
         * included).
         *
         * The payload is the analysed signal as JSON, produced by the web app
         * from LIVE broker candles — this method only DISPLAYS it. A missing
         * "Display over other apps" permission opens the system grant screen
         * instead of failing silently, because a popup that never appears is
         * exactly what the trader would report as "broken".
         */
        @JavascriptInterface
        public void showTradeAnalysis(final String signalJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (signalJson == null || signalJson.trim().isEmpty()) return;
                    if (!overlayAllowed()) {
                        pendingAnalysis = signalJson;
                        try {
                            Intent intent = new Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:" + getPackageName()));
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                            android.widget.Toast.makeText(
                                    MainActivity.this,
                                    "Allow \"Display over other apps\" — the trade card appears when you come back",
                                    android.widget.Toast.LENGTH_LONG).show();
                        } catch (Exception ignored) {
                        }
                        return;
                    }
                    // A running service already has a WindowManager and its
                    // foreground notification; only start one when there is
                    // nothing up to show the card.
                    if (OverlayService.showAnalysisCard(signalJson)) return;
                    Intent intent = new Intent(MainActivity.this, OverlayService.class);
                    intent.putExtra("analysis", signalJson);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent);
                    } else {
                        startService(intent);
                    }
                }
            });
        }

        /** Take the analysis card down. */
        @JavascriptInterface
        public void hideTradeAnalysis() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingAnalysis = null;
                    // Static and instance-gated: hiding must never START the
                    // service (that would spawn a bubble nobody asked for).
                    OverlayService.hideAnalysisCard();
                }
            });
        }

        /**
         * Float the TRADE EXECUTION card over every app (MetaTrader included):
         * `{ ok, headline, detail }`, green for a fill MT5 confirmed and red
         * for a refusal in the broker's own words.
         *
         * DISPLAY ONLY. The web app decides — and verifies with the broker —
         * what happened; this method exists so the trader sees it where they
         * are looking (MetaTrader), not only in a notification.
         */
        @JavascriptInterface
        public void showTradeResult(final String resultJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (resultJson == null || resultJson.trim().isEmpty()) return;
                    // No overlay permission means no floating card at all; a
                    // trade result is not the moment to hijack the screen with
                    // a settings page — the notification still arrived.
                    if (!overlayAllowed()) return;
                    if (OverlayService.showResultCard(resultJson)) return;
                    Intent intent = new Intent(MainActivity.this, OverlayService.class);
                    intent.putExtra("result", resultJson);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent);
                    } else {
                        startService(intent);
                    }
                }
            });
        }

        /** Take the execution card down early. */
        @JavascriptInterface
        public void hideTradeResult() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    OverlayService.hideResultCard();
                }
            });
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
         * Speak a phrase through the native TextToSpeech engine. The WebView's
         * speechSynthesis is silent on Android, so every app announcement
         * (welcome, trade plan, counts) arrives here instead. QUEUE_ADD: the
         * lines queue in order instead of cutting each other off.
         */
        @JavascriptInterface
        public void speak(final String text) {
            speakWithVolume(text, 1.0d);
        }

        /**
         * Speak a phrase at a chosen level (0…1) through the same native
         * engine. The level is applied through the engine's own volume bundle
         * — the only API that actually changes the utterance level. A missing
         * or invalid level falls back to the device default.
         */
        @JavascriptInterface
        public void speakWithVolume(final String text, final double volume) {
            if (text == null || text.trim().isEmpty()) {
                return;
            }
            final float level = (volume < 0.0d || volume > 1.0d || Double.isNaN(volume))
                    ? 1.0f
                    : (float) volume;
            queueSpeech(text, level);
        }

        /** Warm the engine from a user tap — never needed for a gesture rule,
         *  but it makes the first spoken line immediate. */
        @JavascriptInterface
        public void primeVoice() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ensureTts();
                }
            });
        }

        /** Can the engine actually speak right now? Asked by the diagnostics. */
        @JavascriptInterface
        public boolean isVoiceReady() {
            return ttsReady && tts != null;
        }

        /**
         * STOP SPEAKING — the web side calls this when a run has finished
         * executing. The engine speaks with QUEUE_ADD, so without this a batch
         * that is already done keeps reading its backlog aloud. tts.stop() ends
         * the current line AND clears the queue; the held pre-ready line is
         * dropped for the same reason.
         */
        @JavascriptInterface
        public void stopSpeech() {
            pendingSpeech = null;
            pendingVolume = 1.0f;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) {
                        try {
                            tts.stop();
                        } catch (Throwable t) {
                            android.util.Log.e("EAMIGRATE", "stopSpeech failed: " + t);
                        }
                    }
                }
            });
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
        // Same for the analysis card: the grant arrived, so float what the
        // trader asked for without them pressing Analyze again.
        if (pendingAnalysis != null && overlayAllowed()) {
            String json = pendingAnalysis;
            pendingAnalysis = null;
            Intent intent = new Intent(MainActivity.this, OverlayService.class);
            intent.putExtra("analysis", json);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
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

    /** Create the engine once and flush anything that arrived too early. */
    private void ensureTts() {
        if (tts != null) {
            return;
        }
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady && tts != null) {
                        // A device without the US voice pack must still
                        // speak: try the user's own language, then accept
                        // whatever the engine has.
                        int language = tts.setLanguage(Locale.US);
                        if (language == TextToSpeech.LANG_MISSING_DATA
                                || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts.setLanguage(Locale.getDefault());
                        }
                        android.util.Log.i("EAMIGRATE", "TextToSpeech ready");
                    } else {
                        android.util.Log.e("EAMIGRATE", "TextToSpeech init status " + status);
                    }
                    flushPendingSpeech();
                }
            });
        } catch (Throwable t) {
            android.util.Log.e("EAMIGRATE", "TextToSpeech init failed: " + t);
        }
    }

    /** Speak on the UI thread; hold the line until the engine is ready. */
    private void queueSpeech(final String text, final float level) {
        if (!ttsReady || tts == null) {
            pendingSpeech = text;
            pendingVolume = level;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ensureTts();
                }
            });
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                speakNow(text, level);
            }
        });
    }

    /** The ONE place the engine is called, with its volume bundle. */
    private void speakNow(String text, float level) {
        try {
            ensureTts();
            if (!ttsReady || tts == null) {
                pendingSpeech = text;
                pendingVolume = level;
                return;
            }
            android.os.Bundle params = new android.os.Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, level);
            int result = tts.speak(text, TextToSpeech.QUEUE_ADD, params, "eamigrate");
            if (result != TextToSpeech.SUCCESS) {
                android.util.Log.e("EAMIGRATE", "speak returned " + result);
            }
        } catch (Throwable t) {
            android.util.Log.e("EAMIGRATE", "speak failed: " + t);
        }
    }

    /** Speak the line that arrived before the engine finished starting. */
    private void flushPendingSpeech() {
        final String text = pendingSpeech;
        final float level = pendingVolume;
        if (text == null) {
            return;
        }
        pendingSpeech = null;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                speakNow(text, level);
            }
        });
    }

    @Override
    protected void onDestroy() {

        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Throwable t) {
                android.util.Log.e("EAMIGRATE", "tts shutdown failed: " + t);
            }
            tts = null;
            ttsReady = false;
        }
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
