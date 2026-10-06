package app.dsh.android;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** A separate process holds the foreground while the embedded Node process restarts. */
public final class RestartActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.addView(new ProgressBar(this));
        TextView text = new TextView(this);
        text.setText("正在重启 DSH…");
        text.setTextSize(18);
        text.setPadding(24, 24, 24, 24);
        layout.addView(text);
        setContentView(layout);
        int previousPid = getIntent().getIntExtra("previousPid", -1);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (previousPid > 0 && previousPid != android.os.Process.myPid()) android.os.Process.killProcess(previousPid);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                Intent launch = new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(launch);
                finish();
            }, 600);
        }, 350);
    }
}
