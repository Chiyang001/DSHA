package app.dsh.android;
public final class UnicodeInputTestActivity extends android.app.Activity {
    android.widget.EditText editor;
    @Override public void onCreate(android.os.Bundle state) {
        super.onCreate(state);
        editor = new android.widget.EditText(this);
        editor.setHint("DSHAN Unicode 输入测试（不保存内容）");
        editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        setContentView(editor);
        editor.requestFocus();
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
    }
}
