package com.p1ziyu.riichitracker.shell;

import java.net.URI;
import java.net.URISyntaxException;

public final class ShellUrl {
    public static final String DEFAULT_URL = "https://riichi.p1ziyu.com/";
    private static final String HOST = "riichi.p1ziyu.com";

    private ShellUrl() {}

    public static boolean isShellHost(String host) {
        return HOST.equals(host);
    }

    public static boolean isCheckinUrl(String url) {
        URI uri = parse(url);
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && isShellHost(uri.getHost())
                && uri.getRawPath() != null
                && uri.getRawPath().startsWith("/checkin/");
    }

    private static URI parse(String url) {
        if (url == null) return null;
        try {
            return new URI(url);
        } catch (URISyntaxException exception) {
            return null;
        }
    }
}
