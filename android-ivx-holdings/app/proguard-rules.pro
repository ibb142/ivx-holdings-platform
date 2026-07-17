# IVX Holdings ProGuard / R8 rules

# --- Kotlinx Serialization ---
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

# Keep companion objects and serializers
-keepclassmembers class **$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    static <1>$Companion CREATOR;
}
-keep @kotlinx.serialization.Serializable class **
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *;
}

# --- Ktor ---
-dontwarn io.ktor.**
-keep class io.ktor.** { *; }
-keepclassmembers class io.ktor.** { *; }

# --- Koin ---
-dontwarn org.koin.**
-keep class org.koin.** { *; }
-keepclassmembers class org.koin.** { *; }

# --- Coil / OkHttp / Okio ---
-dontwarn coil3.**
-keep class coil3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# --- Compose ---
-dontwarn androidx.compose.**
-keep class androidx.compose.** { *; }

# --- AndroidX Lifecycle / Navigation ---
-keep class androidx.lifecycle.** { *; }
-dontwarn androidx.lifecycle.**
-keep class androidx.navigation.** { *; }

# --- App models ---
-keep class com.rork.ivxholdings.data.model.** { *; }
-keepclassmembers class com.rork.ivxholdings.data.model.** { *; }

# --- Compose metadata ---
-keep @androidx.compose.runtime.Composable class *
-keepclassmembers class * {
    @androidx.compose.runtime.* <methods>;
}

# --- Strip logging in release ---
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}
