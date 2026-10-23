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
        versionCode = 2
        versionName = "0.2.0-p2"
        val apiBase = providers.gradleProperty("ichihimeApiBase").orElse("https://riichi.p1ziyu.com").get()
        buildConfigField("String", "API_BASE_URL", "\"${apiBase.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
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
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
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
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
    // Robolectric publishes no Linux arm64 native runtime. Keep any community-built
    // test-only loader outside the repository and pass its verified path explicitly.
    providers.gradleProperty("robolectricArm64Runtime").orNull?.let { path ->
        require(file(path).isFile) { "Robolectric arm64 test runtime not found: $path" }
        testRuntimeOnly(files(path))
    }
}

tasks.withType<Test>().configureEach {
    // Robolectric's SDK 36 FileDescriptor interceptor needs this JDK 21 export.
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
}
