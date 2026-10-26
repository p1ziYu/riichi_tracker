package com.p1ziyu.riichitracker.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (ShellUrl.isShellHost(request.getUrl().getHost())) return false;
                String scheme = request.getUrl().getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return true;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {
                    // No browser to handle it: swallow rather than crash the shell.
                }
                return true;
            }
        });
        setContentView(webView);
        loadIncoming(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent != null ? intent.getDataString() : null;
        if (ShellUrl.isCheckinUrl(url)) webView.loadUrl(url);
    }

    private void loadIncoming(Intent intent) {
        String url = intent != null ? intent.getDataString() : null;
        webView.loadUrl(ShellUrl.isCheckinUrl(url) ? url : ShellUrl.DEFAULT_URL);
    }
}
