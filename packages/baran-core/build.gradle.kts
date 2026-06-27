plugins {
    kotlin("jvm")
    `java-library`
}

group = "org.baran"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.bouncycastle:bcprov-jdk18on:1.78")

    testImplementation(kotlin("test"))
    testImplementation("com.google.code.gson:gson:2.10.1")
}

kotlin {
    jvmToolchain(17)
}

tasks.withType<Test> {
    useJUnitPlatform()
}
