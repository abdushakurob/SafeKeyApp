<template>
    <div class="landing-page">
      <div class="animated-bg">
        <div
          class="particle"
          v-for="i in 50"
          :key="i"
          :style="getParticleStyle(i)"
        ></div>
      </div>
  
      <header class="header">
        <div class="container">
          <div class="logo">SafeKey</div>
          <button class="cta-button">Join Waitlist</button>
        </div>
      </header>
  
      <main>
        <section class="hero">
          <div class="container">
            <div class="hero-content">
              <h1 class="hero-title">
                One Vault.<br />
                All Your <span class="highlight">Passwords</span>
              </h1>
              <p class="hero-subtitle">/// DECENTRALIZED. RECOVERABLE. YOURS.</p>
              <p class="hero-description">
                SafeKey is a password vault that you own. Store everything
                securely, access from anywhere, recover with your email.
              </p>
              <button class="cta-button-large">Join Waitlist</button>
            </div>
          </div>
        </section>
  
        <section class="features-section">
          <div class="container">
            <div class="features-grid">
              <div class="features-left">
                <p class="section-label">/// WHAT YOU GET</p>
                <h2 class="features-title">
                  Built for <span class="highlight">Control</span>
                </h2>
                <!-- <div class="vault-visual">
                  <div class="vault-mockup">
                    <div class="mockup-header">
                      <div class="mockup-dot"></div>
                      <div class="mockup-dot"></div>
                      <div class="mockup-dot"></div>
                    </div>
                    <div class="mockup-content">
                      <div class="vault-item" v-for="i in 4" :key="i">
                        <div class="vault-icon"></div>
                        <div class="vault-text"></div>
                      </div>
                    </div>
                  </div>
                </div> -->
              </div>
  
              <div class="features-right">
                <div
                  class="feature-item"
                  v-for="(feature, index) in features"
                  :key="index"
                >
                  <div class="feature-icon" v-html="feature.icon"></div>
                  <div class="feature-content">
                    <h3 class="feature-title">{{ feature.title }}</h3>
                    <p class="feature-description">{{ feature.description }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
  
        <section class="how-it-works">
          <div class="container">
            <p class="section-label">/// HOW IT WORKS</p>
            <h2 class="section-title">
              Three Steps to <span class="highlight">Security</span>
            </h2>
  
            <div class="steps">
              <div class="step" v-for="(step, index) in steps" :key="index">
                <div class="step-number">
                  {{ String(index + 1).padStart(2, "0") }}
                </div>
                <h3 class="step-title">{{ step.title }}</h3>
                <p class="step-description">{{ step.description }}</p>
              </div>
            </div>
          </div>
        </section>
  
        <section class="sui-section">
          <div class="container">
            <div class="sui-content">
              <p class="section-label">/// BUILT ON SUI</p>
              <h2 class="sui-title">Powered by the Fastest Blockchain</h2>
              <p class="sui-description">
                SafeKey runs on Sui's high-performance network, giving you instant
                access to your vault with unmatched security and reliability.
              </p>
            </div>
          </div>
        </section>
  
        <section class="cta-section">
          <div class="container">
            <div class="cta-content">
              <h2 class="cta-title">Ready to Own Your Vault?</h2>
              <p class="cta-description">
                Join the waitlist and be first to secure your passwords.
              </p>
              <button class="cta-button-large">Join Waitlist</button>
            </div>
          </div>
        </section>
      </main>
  
      <footer class="footer">
        <div class="container">
          <div class="footer-content">
            <div class="footer-left">
              <div class="logo">SafeKey</div>
              <p class="footer-text">Your vault. Your keys. Your control.</p>
            </div>
            <div class="footer-right">
              <a href="#" class="footer-link">Twitter</a>
              <a href="#" class="footer-link">Discord</a>
              <a href="#" class="footer-link">Docs</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  </template>
  
  <script setup>
  import { ref } from "vue";
  
  const features = ref([
    {
      title: "You Own It",
      description:
        "Your vault lives on the blockchain. No company controls your data.",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>`,
    },
    {
      title: "Access Anywhere",
      description: "Log in from any device and your vault syncs instantly.",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>`,
    },
    {
      title: "Email Recovery",
      description: "Lost your device? Recover your vault with just your email.",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
      </svg>`,
    },
    {
      title: "Always Secure",
      description: "Built on Sui with Move smart contracts for maximum security.",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
      </svg>`,
    },
  ]);
  
  const steps = ref([
    {
      title: "Create Your Vault",
      description:
        "Sign up with your email. Your vault is created instantly on Sui.",
    },
    {
      title: "Add Passwords",
      description:
        "Store credentials for any site or app. Everything stays secure.",
    },
    {
      title: "Access Anywhere",
      description: "Log in from any device and your vault syncs automatically.",
    },
  ]);
  
  const getParticleStyle = (index) => {
    return {
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 5}s`,
      animationDuration: `${15 + Math.random() * 10}s`,
    };
  };
  </script>
  
  <style scoped>
  @import url("https://fonts.googleapis.com/css2?family=Satoshi:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap");
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  .landing-page {
    background: #0a0a0a;
    color: #ffffff;
    font-family: "Satoshi", -apple-system, BlinkMacSystemFont, sans-serif;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }
  
  .animated-bg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
  
  .particle {
    position: absolute;
    width: 2px;
    height: 2px;
    background: rgba(191, 255, 11, 0.3);
    border-radius: 50%;
    animation: float linear infinite;
  }
  
  @keyframes float {
    0%,
    100% {
      transform: translate(0, 0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      transform: translate(calc(var(--tx, 0) * 1px), calc(var(--ty, 100) * 1px));
      opacity: 0;
    }
  }
  
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
    position: relative;
    z-index: 1;
  }
  
  .header {
    padding: 2rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .header .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .logo {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  
  .cta-button {
    background: transparent;
    border: 1px solid rgba(191, 255, 11, 0.5);
    color: #bfff0b;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
    font-family: "Satoshi", sans-serif;
  }
  
  .cta-button:hover {
    background: rgba(191, 255, 11, 0.1);
    border-color: #bfff0b;
    transform: translateY(-2px);
  }
  
  .hero {
    padding: 8rem 0 6rem;
  }
  
  .hero-content {
    max-width: 800px;
  }
  
  .hero-title {
    font-size: clamp(3rem, 8vw, 6rem);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 1.5rem;
  }
  
  .highlight {
    color: #bfff0b;
  }
  
  .hero-subtitle {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 2rem;
    letter-spacing: 0.05em;
  }
  
  .hero-description {
    font-size: 1.25rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 3rem;
    max-width: 600px;
  }
  
  .cta-button-large {
    background: #bfff0b;
    color: #0a0a0a;
    border: none;
    padding: 1.25rem 3rem;
    border-radius: 0.5rem;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    font-family: "Satoshi", sans-serif;
  }
  
  .cta-button-large:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 40px rgba(191, 255, 11, 0.3);
  }
  
  .features-section {
    padding: 6rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .section-label {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 1rem;
    letter-spacing: 0.05em;
  }
  
  .features-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6rem;
    align-items: start;
  }
  
  .features-left {
    position: sticky;
    top: 2rem;
  }
  
  .features-title {
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: 3rem;
  }
  
  .vault-visual {
    margin-top: 3rem;
  }
  
  .vault-mockup {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
    backdrop-filter: blur(10px);
  }
  
  .mockup-header {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .mockup-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
  }
  
  .vault-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 0.5rem;
    margin-bottom: 0.75rem;
  }
  
  .vault-icon {
    width: 40px;
    height: 40px;
    border-radius: 0.5rem;
    background: rgba(191, 255, 11, 0.1);
    border: 1px solid rgba(191, 255, 11, 0.3);
  }
  
  .vault-text {
    flex: 1;
    height: 12px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 0.25rem;
  }
  
  .features-right {
    display: flex;
    flex-direction: column;
    gap: 3rem;
  }
  
  .feature-item {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
    transition: all 0.3s ease;
  }
  
  .feature-item:hover {
    transform: translateX(10px);
  }
  
  .feature-icon {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bfff0b;
    transition: all 0.3s ease;
  }
  
  .feature-item:hover .feature-icon {
    transform: scale(1.1);
  }
  
  .feature-content {
    flex: 1;
  }
  
  .feature-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.01em;
  }
  
  .feature-description {
    font-size: 1rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .how-it-works {
    padding: 6rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .section-title {
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: 4rem;
  }
  
  .steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3rem;
  }
  
  .step {
    position: relative;
  }
  
  .step-number {
    font-family: "JetBrains Mono", monospace;
    font-size: 3rem;
    font-weight: 700;
    color: rgba(191, 255, 11, 0.2);
    margin-bottom: 1rem;
  }
  
  .step-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.75rem;
    letter-spacing: -0.01em;
  }
  
  .step-description {
    font-size: 1rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .sui-section {
    padding: 6rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .sui-content {
    max-width: 700px;
  }
  
  .sui-title {
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 900;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin-bottom: 1.5rem;
  }
  
  .sui-description {
    font-size: 1.25rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .cta-section {
    padding: 8rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .cta-content {
    text-align: center;
    max-width: 600px;
    margin: 0 auto;
  }
  
  .cta-title {
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: 1.5rem;
  }
  
  .cta-description {
    font-size: 1.25rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 3rem;
  }
  
  .footer {
    padding: 3rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .footer-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .footer-text {
    color: rgba(255, 255, 255, 0.5);
    margin-top: 0.5rem;
  }
  
  .footer-right {
    display: flex;
    gap: 2rem;
  }
  
  .footer-link {
    color: rgba(255, 255, 255, 0.7);
    text-decoration: none;
    transition: color 0.3s ease;
  }
  
  .footer-link:hover {
    color: #bfff0b;
  }
  
  @media (max-width: 968px) {
    .features-grid {
      grid-template-columns: 1fr;
      gap: 4rem;
    }
  
    .features-left {
      position: relative;
      top: 0;
    }
  
    .steps {
      grid-template-columns: 1fr;
      gap: 3rem;
    }
  
    .footer-content {
      flex-direction: column;
      gap: 2rem;
      text-align: center;
    }
  }
  </style>