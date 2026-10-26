package com.p1ziyu.riichitracker.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ShellUrlTest {
    @Test public void defaultUrlIsProductionSite() {
        assertEquals("https://riichi.p1ziyu.com/", ShellUrl.DEFAULT_URL);
    }

    @Test public void shellHostRequiresExactHostname() {
        assertTrue(ShellUrl.isShellHost("riichi.p1ziyu.com"));
        assertFalse(ShellUrl.isShellHost("evil-riichi.p1ziyu.com"));
        assertFalse(ShellUrl.isShellHost("riichi.p1ziyu.com.evil.com"));
        assertFalse(ShellUrl.isShellHost(null));
    }

    @Test public void checkinNeedsHttpsHostAndPathPrefix() {
        assertTrue(ShellUrl.isCheckinUrl("https://riichi.p1ziyu.com/checkin/abc?token=xyz"));
        assertFalse(ShellUrl.isCheckinUrl("https://riichi.p1ziyu.com/"));
        assertFalse(ShellUrl.isCheckinUrl("https://evil.example/checkin/abc"));
        assertFalse(ShellUrl.isCheckinUrl("http://riichi.p1ziyu.com/checkin/abc"));
        assertFalse(ShellUrl.isCheckinUrl("https://riichi.p1ziyu.com/checkin"));
        assertFalse(ShellUrl.isCheckinUrl(null));
    }
}
