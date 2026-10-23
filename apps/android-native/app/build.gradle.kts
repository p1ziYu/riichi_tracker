plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
    kotlin("plugin.serialization")
}

android {
    namespace = "com.p1ziyu.riichitracker.p1"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.p1ziyu.riichitracker.native"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-p1"
        val apiBase = providers.gradleProperty("ichihimeApiBase").orElse("https://riichi.p1ziyu.com").get()
        buildConfigField("String", "API_BASE_URL", "\"${apiBase.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_debug"
        }
        getByName("release") {
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_release"
        }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    implementation("com.riichi:mobile-engine:0.1.0")
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
}
