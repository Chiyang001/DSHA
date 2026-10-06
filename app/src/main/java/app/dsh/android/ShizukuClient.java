package app.dsh.android;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import rikka.shizuku.Shizuku;

final class ShizukuClient {
    private static final int PERMISSION_REQUEST = 101;
    private final Context context;
    private volatile IBinder shell;
    private volatile CountDownLatch connected = new CountDownLatch(1);
    private volatile boolean binding;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Shizuku.UserServiceArgs serviceArgs;
    private final Runnable bindTimeout = this::onBindTimeout;
    private void onBindTimeout() {
        synchronized (this) {
            if (!binding || isReady()) return;
            binding = false;
            try { Shizuku.unbindUserService(serviceArgs, connection, false); }
            catch (RuntimeException ignored) {}
            connected.countDown();
            update("Shizuku 服务连接超时，请点击授权按钮重试");
        }
    }
    private volatile NodeRuntime.Status status;
    private volatile String statusMessage = "Shizuku 尚未连接";

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            main.removeCallbacks(bindTimeout);
            binding = false;
            shell = binder;
            connected.countDown();
            update("Shizuku 已连接；可授权 Harness 操作");
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            main.removeCallbacks(bindTimeout);
            shell = null;
            binding = false;
            connected = new CountDownLatch(1);
            update("Shizuku 连接中断，请重新授权");
        }
    };

    ShizukuClient(Context context) {
        this.context = context.getApplicationContext();
        serviceArgs = new Shizuku.UserServiceArgs(
            new ComponentName(this.context, RemoteShellService.class))
            .processNameSuffix("dsh-shell").tag("dsh-shell").version(2);
        Shizuku.addBinderReceivedListenerSticky(() -> {
            if (hasPermission()) bind();
            else update("Shizuku 已启动；点击按钮授权");
        });
        Shizuku.addBinderDeadListener(() -> {
            main.removeCallbacks(bindTimeout);
            shell = null;
            binding = false;
            connected = new CountDownLatch(1);
            update("Shizuku 服务已停止");
        });
        Shizuku.addRequestPermissionResultListener((code, result) -> {
            if (code != PERMISSION_REQUEST) return;
            if (result == PackageManager.PERMISSION_GRANTED) bind();
            else update("Shizuku 授权未通过");
        });
    }

    void setStatus(NodeRuntime.Status callback) {
        status = callback;
        if (callback != null) callback.update(statusMessage);
    }
    void refresh() {
        try {
            if (hasPermission()) bind();
            else if (Shizuku.pingBinder()) update("Shizuku 已启动；点击按钮授权");
            else update("请先在 Shizuku 中启动服务");
        } catch (RuntimeException error) {
            update("Shizuku 状态检查失败，请重试：" + error.getMessage());
        }
    }
    boolean isReady() { return shell != null && shell.isBinderAlive(); }
    String statusMessage() { return statusMessage; }

    void request() {
        if (!Shizuku.pingBinder()) {
            Intent intent = context.getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api");
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                update("请先在 Shizuku 中启动服务，再返回此处授权");
            } else update("请先安装并启动 Shizuku");
            return;
        }
        if (Shizuku.isPreV11()) { update("Shizuku 版本过旧，请升级"); return; }
        if (hasPermission()) bind();
        else if (Shizuku.shouldShowRequestPermissionRationale())
            update("请在 Shizuku 的“已授权应用”中允许此应用");
        else Shizuku.requestPermission(PERMISSION_REQUEST);
    }

    private boolean hasPermission() {
        return Shizuku.pingBinder() && !Shizuku.isPreV11()
            && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
    }

    private synchronized void bind() {
        if (isReady()) { update("Shizuku 已连接；可授权 Harness 操作"); return; }
        if (binding) return;
        binding = true;
        connected = new CountDownLatch(1);
        try {
            update("正在连接 Shizuku…");
            main.postDelayed(bindTimeout, 10000);
            Shizuku.bindUserService(serviceArgs, connection);
        } catch (RuntimeException error) {
            main.removeCallbacks(bindTimeout);
            binding = false;
            update("Shizuku 连接失败：" + error.getMessage());
        }
    }

    byte[] execute(String command, int maxBytes) throws Exception {
        if (!isReady()) {
            if (!hasPermission()) throw new IllegalStateException("Shizuku 尚未授权");
            bind();
            if (!connected.await(10, TimeUnit.SECONDS) || !isReady())
                throw new IllegalStateException("Shizuku 服务连接超时");
        }
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(
                RemoteShellService.executeOn(shell, command))) {
            return AdbClient.readAll(in, maxBytes);
        }
    }

    byte[] captureDisplay(int displayId) throws Exception {
        if (!isReady()) throw new IllegalStateException("副屏截图需要已连接的 Shizuku");
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(
                RemoteShellService.captureOn(shell, displayId))) {
            return AdbClient.readAll(in, 12 * 1024 * 1024);
        }
    }

    org.json.JSONArray displays() throws Exception {
        if (!isReady()) throw new IllegalStateException("副屏操作需要已连接的 Shizuku");
        return new org.json.JSONArray(RemoteShellService.displaysOn(shell));
    }

    private void update(String text) {
        statusMessage = text;
        if (status != null) status.update(text);
    }
}
