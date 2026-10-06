package app.dsh.android;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/** Explicit su authorization; never requests root from a status read. */
final class RootClient {
    interface Launcher { Process start(String command) throws Exception; }
    private final Launcher launcher;
    RootClient() { this(command -> new ProcessBuilder("su", "-c", command).start()); }
    RootClient(Launcher launcher) { this.launcher = launcher; }
    private volatile boolean available;
    private volatile String status = "尚未检测 Root；点击检测并在 Root 管理器中授权";

    boolean isReady() { return available; }
    String statusMessage() { return status; }

    synchronized boolean request() {
        try {
            String uid = new String(run("id -u", 1024, 30), StandardCharsets.UTF_8).trim();
            available = "0".equals(uid);
            status = available ? "Root 已授权（UID 0）" : "未取得 Root 权限，请检查 Root 管理器授权";
        } catch (Exception error) {
            available = false;
            status = "Root 不可用：" + error.getMessage();
        }
        return available;
    }

    byte[] execute(String command, int maxBytes) throws Exception {
        if (!available) throw new IllegalStateException("Root 模式未授权，请重新检测并授权 Root");
        try {
            // Check UID inside every invocation; revoked grants never execute as shell.
            return run("[ \"$(id -u)\" = 0 ] || exit 126; " + command, maxBytes, 30);
        } catch (Exception error) {
            available = false;
            status = "Root 执行失败，请重新检测授权：" + error.getMessage();
            throw error;
        }
    }

    private byte[] run(String command, int maxBytes, int seconds) throws Exception {
        Process process = launcher.start(command);
        java.util.concurrent.ExecutorService readers = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            process.getOutputStream().close();
            java.util.concurrent.Future<byte[]> output = readers.submit(() -> read(process.getInputStream(), maxBytes));
            java.util.concurrent.Future<byte[]> errors = readers.submit(() -> read(process.getErrorStream(), 16384));
            if (!process.waitFor(seconds, TimeUnit.SECONDS))
                throw new IllegalStateException("ROOT_OUTCOME_UNKNOWN: Root 请求超时，请检查授权或操作结果，不要重复操作");
            byte[] bytes = output.get(2, TimeUnit.SECONDS);
            String diagnostic = new String(errors.get(2, TimeUnit.SECONDS), StandardCharsets.UTF_8).trim();
            if (process.exitValue() != 0)
                throw new IllegalStateException("su 退出码 " + process.exitValue() + (diagnostic.isEmpty() ? "" : "：" + diagnostic));
            return bytes;
        } finally {
            process.destroyForcibly();
            process.getInputStream().close();
            process.getErrorStream().close();
            readers.shutdownNow();
        }
    }

    private static byte[] read(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        boolean overflow = false;
        while ((count = input.read(buffer)) != -1) {
            int remaining = limit - output.size();
            if (count > remaining) overflow = true;
            if (remaining > 0) output.write(buffer, 0, Math.min(count, remaining));
        }
        if (overflow) throw new IllegalStateException("Root 命令输出超过上限");
        return output.toByteArray();
    }
}
