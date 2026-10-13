// EA_Migrate_Notify.mqh — trade push notifications for EA Migrate Pro.
//
// HOW TO USE
//   1. Put this file in MQL5/Include/ (MT5) or MQL4/Include/ (MT4).
//   2. In your EA:  #include <EA_Migrate_Notify.mqh>
//   3. OnInit():    NotifyInit("your.email@example.com", "YOUR_TRADE_WEBHOOK_SECRET");
//   4. On every executed trade:
//        NotifyTrade("EURUSD", TRADE_BUY, 0.10, 1.0850, 2.30, ticket);
//      and NotifyTrade(..., TRADE_CLOSE, ...) on close.
//
// The secret must equal TRADE_WEBHOOK_SECRET on Vercel. WebRequest needs the
// URL whitelisted: Tools → Options → Expert Advisors → "Allow WebRequest for
// listed URL" → https://eamigratepro.vercel.app

#property strict

#define TRADE_NOTIFY_URL "https://eamigratepro.vercel.app/api/trade-notify"

enum ENUM_TRADE_ACTION
{
   TRADE_BUY   = 0,   // BUY
   TRADE_SELL  = 1,   // SELL
   TRADE_CLOSE = 2    // CLOSE
};

string g_notifyEmail = "";
string g_notifySecret = "";

void NotifyInit(const string email, const string secret)
{
   g_notifyEmail = email;
   g_notifySecret = secret;
}

// Builds the JSON body and fires it at POST /api/trade-notify.
// Returns true when the server answered 200 with ok:true.
bool NotifyTrade(const string symbol,
                 const ENUM_TRADE_ACTION action,
                 const double volume,
                 const double price,
                 const double profit,
                 const long ticket = 0)
{
   if(g_notifyEmail == "" || g_notifySecret == "")
      return(false);

   string actionName = action == TRADE_BUY ? "BUY" : (action == TRADE_SELL ? "SELL" : "CLOSE");
   string body = StringFormat(
      "{\"secret\":\"%s\",\"email\":\"%s\",\"symbol\":\"%s\",\"action\":\"%s\",\"volume\":%.2f,\"price\":%.5f,\"profit\":%.2f,\"ticket\":\"%I64d\"}",
      g_notifySecret, g_notifyEmail, symbol, actionName, volume, price, profit, ticket);

   char post[];
   char result[];
   string headers = "Content-Type: application/json\r\n";
   StringToCharArray(body, post, 0, StringLen(body)); // no trailing NULL
   ResetLastError();
   int timeout = 5000;
   int status = WebRequest("POST", TRADE_NOTIFY_URL, headers, timeout, post, result, headers);
   if(status == -1)
   {
      // URL not whitelisted or connection failed — tell the operator once.
      Print("NotifyTrade: WebRequest failed (err=", GetLastError(),
            "). Add ", TRADE_NOTIFY_URL, " to WebRequest allowed URLs.");
      return(false);
   }
   string reply = CharArrayToString(result);
   return(status == 200 && StringFind(reply, "\"ok\":true") >= 0);
}
