# =============================================================================
# IWM — R8 / ProGuard keep rules
# =============================================================================
#
# These are in place and correct, but minifyEnabled is currently false in
# build.gradle — see the comment there for why, and for what to test before
# turning it on.
#
# WHY A CAPACITOR APP NEEDS KEEP RULES AT ALL
# -------------------------------------------
# Capacitor does not reference plugin classes from Java. It finds them at
# runtime by scanning for the @CapacitorPlugin annotation and then invokes
# their methods reflectively by name, matching the string the JavaScript side
# passed. R8 sees classes nobody calls and methods nobody references, and
# removes or renames them — which is exactly right for ordinary code and
# exactly wrong here.
#
# The failure is quiet and late: the build succeeds, the app launches, and then
# the first call into a stripped plugin throws at the moment a user taps the
# thing that needs it. Each rule below names what breaks without it.

# --- Capacitor core ----------------------------------------------------------
# The bridge, the plugin base class and the annotation types are all reached
# reflectively.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep enum com.getcapacitor.** { *; }

# Every plugin, ours or a dependency's. Without this, SecureStorage and
# Filesystem are the first to go, taking sign-in persistence and every report
# export with them.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }

# The annotations themselves must survive, or the scan above finds nothing.
-keepattributes *Annotation*

# --- Cordova compatibility layer --------------------------------------------
# Capacitor loads Cordova plugins through the same reflective path. None are
# installed today; the rule costs nothing and avoids a confusing failure if one
# is added later.
-keep class org.apache.cordova.** { *; }

# --- WebView JavaScript interfaces ------------------------------------------
# @JavascriptInterface methods are called by name from JS. Renaming them
# severs the bridge entirely and the app opens to a blank WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- AndroidX security (EncryptedSharedPreferences) --------------------------
# The backing store for the session token. Built through a builder that
# resolves Tink primitives reflectively.
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# --- Readable crash reports --------------------------------------------------
# Keeps line numbers in stack traces while still obfuscating the source file
# name. Without these, a Play Console crash from a minified build is a list of
# single-letter classes.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Suppress noise from optional dependencies ------------------------------
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
