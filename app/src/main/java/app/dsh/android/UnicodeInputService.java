package app.dsh.android;

import android.inputmethodservice.InputMethodService;
import android.os.Handler;
import android.os.Looper;
import android.view.inputmethod.InputConnection;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** In-process input only: no exported text receiver or clipboard transport. */
public final class UnicodeInputService extends InputMethodService {
    private static UnicodeInputService active;
    private long generation;
    @Override public void onStartInput(android.view.inputmethod.EditorInfo info, boolean restarting) {
        super.onStartInput(info, restarting); generation++;
    }
    @Override public void onFinishInput() { generation++; super.onFinishInput(); }
    static final class Target {
        final int uid, pid;
        final long generation;
        final InputConnection connection;
        Target(UnicodeInputService service) {
            uid = service.getCurrentInputBinding().getUid();
            pid = service.getCurrentInputBinding().getPid();
            generation = service.generation;
            connection = service.getCurrentInputConnection();
        }
    }
    static Target target() throws Exception {
        CompletableFuture<Target> result = new CompletableFuture<>();
        new Handler(Looper.getMainLooper()).post(() -> {
            UnicodeInputService service = active;
            result.complete(service != null && service.getCurrentInputStarted() && service.getCurrentInputBinding() != null
                && service.getCurrentInputConnection() != null ? new Target(service) : null);
        });
        return result.get(2, TimeUnit.SECONDS);
    }
    @Override public void onCreate() { super.onCreate(); active = this; }
    @Override public void onDestroy() { if (active == this) active = null; super.onDestroy(); }

    static void commit(String text, Target expected) throws Exception {
        CompletableFuture<Boolean> result = new CompletableFuture<>();
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable attempt = new Runnable() {
            int tries;
            public void run() {
                if (result.isDone()) return;
                UnicodeInputService service = active;
                InputConnection connection = service == null ? null : service.getCurrentInputConnection();
                if (connection == null || !service.getCurrentInputStarted()) {
                    if (++tries < 50) handler.postDelayed(this, 100);
                    else result.completeExceptionally(new IllegalStateException("请先点击目标输入框，使其获得输入焦点"));
                    return;
                }
                android.view.inputmethod.InputBinding binding = service.getCurrentInputBinding();
                if (binding == null || service.generation != expected.generation || connection != expected.connection
                        || binding.getUid() != expected.uid || binding.getPid() != expected.pid) {
                    result.completeExceptionally(new IllegalStateException("INPUT_FOCUS_CHANGED: 输入目标发生变化，未输入文字，请重新聚焦指定副屏输入框"));
                    return;
                }
                // Submit exactly once. Never retry an uncertain commit.
                try { result.complete(connection.commitText(text, 1)); }
                catch (Exception error) { result.completeExceptionally(error); }
            }
        };
        handler.post(attempt);
        try {
            if (!result.get(7, TimeUnit.SECONDS)) throw new IllegalStateException("ACTION_OUTCOME_UNKNOWN: 输入框未确认文字提交，请检查后再操作");
        } finally { result.cancel(false); handler.removeCallbacks(attempt); }
    }
}
