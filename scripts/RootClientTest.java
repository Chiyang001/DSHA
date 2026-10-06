package app.dsh.android;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public final class RootClientTest {
    static final class FakeProcess extends Process {
        final byte[] bytes;
        final int exit;
        final boolean completed;
        boolean destroyed;
        FakeProcess(byte[] bytes, int exit, boolean completed) { this.bytes = bytes; this.exit = exit; this.completed = completed; }
        public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        public InputStream getInputStream() { return new ByteArrayInputStream(bytes); }
        public InputStream getErrorStream() { return new ByteArrayInputStream("diagnostic".getBytes(StandardCharsets.UTF_8)); }
        public int waitFor() { return exit; }
        public boolean waitFor(long timeout, TimeUnit unit) { return completed; }
        public int exitValue() { return exit; }
        public void destroy() { destroyed = true; }
        public Process destroyForcibly() { destroyed = true; return this; }
    }
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        java.util.ArrayDeque<FakeProcess> runs = new java.util.ArrayDeque<>();
        RootClient root = new RootClient(command -> {
            if (!command.equals("id -u")) check(command.startsWith("[ \"$(id -u)\" = 0 ] || exit 126; "));
            return runs.remove();
        });
        check(!root.isReady());
        runs.add(new FakeProcess("2000\n".getBytes(), 0, true));
        check(!root.request());
        runs.add(new FakeProcess("0\n".getBytes(), 0, true));
        check(root.request());
        byte[] png = { (byte) 137, 80, 78, 71, 0, (byte) 255 };
        FakeProcess capture = new FakeProcess(png, 0, true);
        runs.add(capture);
        check(java.util.Arrays.equals(root.execute("screencap -p", 100), png));
        check(capture.destroyed);
        runs.add(new FakeProcess(new byte[0], 126, true));
        try { root.execute("input tap 1 2", 100); throw new AssertionError(); }
        catch (IllegalStateException expected) { check(!root.isReady()); }
        FakeProcess stalled = new FakeProcess(new byte[0], 0, false);
        runs.add(stalled);
        check(!root.request());
        check(stalled.destroyed && root.statusMessage().contains("OUTCOME_UNKNOWN"));
        runs.add(new FakeProcess("0\n".getBytes(), 0, true));
        check(root.request());
        runs.add(new FakeProcess(new byte[101], 0, true));
        try { root.execute("cat file", 100); throw new AssertionError(); }
        catch (Exception expected) { check(!root.isReady()); }
        System.out.println("RootClient tests passed: UID, binary output, revoked grant, timeout, output limit");
    }
}
