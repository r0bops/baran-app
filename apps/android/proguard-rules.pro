# Baran APK ProGuard/R8 rules.

# Keep BouncyCastle crypto providers used by baran-core (reflection-loaded).
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Jetpack Compose
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**

# Keep the shared record/domain model (serialized to/from canonical maps).
-keep class baran.domain.** { *; }
-keep class baran.app.** { *; }
