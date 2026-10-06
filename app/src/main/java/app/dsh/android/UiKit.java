package app.dsh.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.TextView;

/** Minimal black-and-white theme helpers. */
final class UiKit {
    static final int BG = 0xFF0A0A0A;
    static final int SURFACE = 0xFFFFFFFF;
    static final int TEXT_ON_DARK = 0xFFF2F2F2;
    static final int TEXT_MUTED = 0xFF8A8A8A;
    static final int TEXT_ON_LIGHT = 0xFF111111;
    static final int TEXT_SECONDARY = 0xFF555555;
    static final int BORDER = 0xFF2A2A2A;
    static final int OVERLAY = 0xFF0A0A0A;

    private UiKit() {}

    static int dp(Context context, int value) {
        return (int) (value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable roundedRect(int color, Context context, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(context, radiusDp));
        drawable.setColor(color);
        return drawable;
    }

    static GradientDrawable roundedStroke(Context context, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(context, radiusDp));
        drawable.setColor(Color.TRANSPARENT);
        drawable.setStroke(dp(context, strokeDp), strokeColor);
        return drawable;
    }

    static void stylePrimaryButton(Button button, Context context) {
        stylePrimaryButtonOnLight(button, context);
    }

    /** Primary button for white cards — black fill, white text. */
    static void stylePrimaryButtonOnLight(Button button, Context context) {
        button.setAllCaps(false);
        button.setTextColor(TEXT_ON_DARK);
        button.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        button.setBackground(roundedRect(0xFF111111, context, 14));
        button.setStateListAnimator(null);
        button.setElevation(0);
        button.setPadding(dp(context, 20), dp(context, 14), dp(context, 20), dp(context, 14));
    }

    static void styleSecondaryButton(Button button, Context context) {
        button.setAllCaps(false);
        button.setTextColor(TEXT_ON_DARK);
        button.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        button.setBackground(roundedStroke(context, 14, TEXT_ON_DARK, 2));
        button.setStateListAnimator(null);
        button.setElevation(0);
        button.setPadding(dp(context, 20), dp(context, 14), dp(context, 20), dp(context, 14));
    }

    /** Secondary button for white cards — dark text and border for contrast. */
    static void styleSecondaryButtonOnLight(Button button, Context context) {
        button.setAllCaps(false);
        button.setTextColor(TEXT_ON_LIGHT);
        button.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        GradientDrawable drawable = roundedRect(0xFFF3F3F3, context, 14);
        drawable.setStroke(dp(context, 2), TEXT_ON_LIGHT);
        button.setBackground(drawable);
        button.setStateListAnimator(null);
        button.setElevation(0);
        button.setPadding(dp(context, 20), dp(context, 14), dp(context, 20), dp(context, 14));
    }

    static void styleCard(View view, Context context) {
        view.setBackground(roundedRect(SURFACE, context, 20));
        view.setElevation(0);
    }

    static void styleCheck(CheckBox box) {
        box.setTextColor(TEXT_ON_LIGHT);
        box.setButtonTintList(android.content.res.ColorStateList.valueOf(TEXT_ON_LIGHT));
    }

    static TextView label(Context context, String text, float sizeSp, int color, int style) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create(Typeface.DEFAULT, style));
        return view;
    }
}
