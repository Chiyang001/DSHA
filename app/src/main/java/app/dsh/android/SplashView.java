package app.dsh.android;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Quiet branding with an accessible, scrollable startup status. */
final class SplashView extends FrameLayout {
    private final TextView statusText;
    private final SplashLoaderView loader;
    private final LinearLayout content;
    SplashView(Context context) {
        super(context);
        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(dp(32), dp(32), dp(32), dp(32));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        FrameLayout emblem = new FrameLayout(context);
        GradientDrawable glass = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] {0xFF1C293B, 0xFF101824});
        glass.setCornerRadius(dp(28));
        glass.setStroke(dp(1), 0xFF33445B);
        emblem.setBackground(glass);
        ImageView logo = new ImageView(context);
        logo.setImageResource(R.drawable.app_icon);
        // Present the existing black-on-white icon as an ice-white silhouette.
        // Alpha = original alpha minus red preserves transparent outer corners.
        logo.setColorFilter(new android.graphics.ColorMatrixColorFilter(new float[] {
            0, 0, 0, 0, 218,
            0, 0, 0, 0, 234,
            0, 0, 0, 0, 255,
            -1, 0, 0, 1, 0
        }));
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        emblem.addView(logo, new FrameLayout.LayoutParams(dp(70), dp(70), Gravity.CENTER));
        content.addView(emblem, new LinearLayout.LayoutParams(dp(108), dp(108)));
        TextView title = UiKit.label(context, "DeepSeek Harness", 26, UiKit.TEXT_ON_DARK, Typeface.NORMAL);
        title.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        title.setLetterSpacing(.04f);
        title.setGravity(Gravity.CENTER);
        add(title, -1, -2, 28);
        TextView platform = UiKit.label(context, "Android", 11, 0xFF9BAABE, Typeface.NORMAL);
        platform.setGravity(Gravity.CENTER);
        platform.setPadding(dp(14), dp(5), dp(14), dp(5));
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(0xFF141E2C);
        pill.setCornerRadius(dp(30));
        pill.setStroke(dp(1), 0xFF28364A);
        platform.setBackground(pill);
        add(platform, -2, -2, 18);
        loader = new SplashLoaderView(context);
        add(loader, dp(148), dp(12), 40);
        statusText = UiKit.label(context, "正在启动 Harness…", 12, 0xFF93A4BB, Typeface.NORMAL);
        statusText.setGravity(Gravity.CENTER);
        statusText.setLineSpacing(dp(3), 1);
        statusText.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        add(statusText, -1, -2, 12);
    }
    private int dp(int value) { return UiKit.dp(getContext(), value); }
    private void add(View view, int width, int height, int margin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.gravity = Gravity.CENTER_HORIZONTAL;
        params.topMargin = dp(margin);
        content.addView(view, params);
    }
    @Override public void onVisibilityAggregated(boolean visible) {
        super.onVisibilityAggregated(visible);
        if (content == null) return;
        for (int i = 0; i < content.getChildCount(); i++) {
            View child = content.getChildAt(i);
            child.animate().cancel();
            child.setAlpha(1);
            child.setTranslationY(0);
            if (visible && ValueAnimator.areAnimatorsEnabled()) {
                child.setAlpha(0);
                child.setTranslationY(dp(8));
                child.animate().alpha(1).translationY(0).setStartDelay(i * 45L)
                    .setDuration(480).setInterpolator(new DecelerateInterpolator(1.6f)).start();
            }
        }
    }
    void setStatus(String message) {
        if (message == null || message.contentEquals(statusText.getText())) return;
        boolean failed = message.contains("失败") || message.contains("超时") || message.contains("已退出");
        loader.setFailed(failed);
        statusText.setTextColor(failed ? 0xFFE4ABA2 : 0xFF93A4BB);
        statusText.setText(message);
    }

}
