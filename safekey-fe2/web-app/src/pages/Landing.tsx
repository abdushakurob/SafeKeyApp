import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import * as THREE from 'three'
import './Landing.css'
import logoLight from '../assets/logo_light.png'

gsap.registerPlugin(ScrollTrigger)

// --- Three.js Background Component ---
const ThreeBackground = () => {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mountRef.current) return

    // Scene Setup
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x050505, 0.002)

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.z = 30

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mountRef.current.appendChild(renderer.domElement)

    // Particles
    const geometry = new THREE.BufferGeometry()
    const count = 3000
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    const color1 = new THREE.Color(0xccff00)
    const color2 = new THREE.Color(0x00ffcc)

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 150
      positions[i * 3 + 1] = (Math.random() - 0.5) * 150
      positions[i * 3 + 2] = (Math.random() - 0.5) * 150

      const mixedColor = color1.clone().lerp(color2, Math.random())
      colors[i * 3] = mixedColor.r
      colors[i * 3 + 1] = mixedColor.g
      colors[i * 3 + 2] = mixedColor.b
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    // Animation Loop
    let mouseX = 0
    let mouseY = 0
    let targetX = 0
    let targetY = 0

    const handleMouseMove = (event: MouseEvent) => {
      mouseX = (event.clientX - window.innerWidth / 2) * 0.02
      mouseY = (event.clientY - window.innerHeight / 2) * 0.02
    }

    document.addEventListener('mousemove', handleMouseMove)

    const animate = () => {
      requestAnimationFrame(animate)

      targetX = mouseX * 0.5
      targetY = mouseY * 0.5

      particles.rotation.y += 0.0005
      particles.rotation.x += (targetY * 0.01 - particles.rotation.x) * 0.05
      particles.rotation.y += (targetX * 0.01 - particles.rotation.y) * 0.05

      renderer.render(scene, camera)
    }

    animate()

    // Resize Handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('mousemove', handleMouseMove)
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement)
      }
      geometry.dispose()
      material.dispose()
    }
  }, [])

  return <div ref={mountRef} className="three-bg" />
}

export default function Landing() {
  const navigate = useNavigate()

  // Refs for GSAP
  const heroRef = useRef<HTMLDivElement>(null)
  const howRef = useRef<HTMLDivElement>(null)
  const howTrackRef = useRef<HTMLDivElement>(null)
  const vaultRef = useRef<HTMLDivElement>(null)
  const invisibleRef = useRef<HTMLDivElement>(null)
  const realPeopleRef = useRef<HTMLDivElement>(null)
  const alwaysOnRef = useRef<HTMLDivElement>(null)
  const hoodRef = useRef<HTMLDivElement>(null)
  const hoodTrackRef = useRef<HTMLDivElement>(null)
  const betaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // const handleScroll = () => setScrollY(window.scrollY)
    // window.addEventListener('scroll', handleScroll)
    // return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // GSAP Animations
  useEffect(() => {
    const ctx = gsap.context(() => {
      // Hero Animations
      gsap.from('.hero-text-anim', {
        y: 50,
        opacity: 0,
        duration: 1.2,
        stagger: 0.1,
        ease: 'power3.out',
        delay: 0.2
      })

      // How You Use It - Horizontal Scroll
      if (howRef.current && howTrackRef.current) {
        const track = howTrackRef.current
        const scrollWidth = track.scrollWidth
        const winWidth = window.innerWidth

        if (scrollWidth > winWidth) {
          gsap.to(track, {
            x: () => -(scrollWidth - winWidth),
            ease: 'none',
            scrollTrigger: {
              trigger: howRef.current,
              pin: true,
              scrub: 1,
              end: () => '+=' + (scrollWidth - winWidth),
              invalidateOnRefresh: true
            }
          })
        }
      }

      // Vault Grid - Stagger Animation
      gsap.from('.vault-card', {
        scrollTrigger: {
          trigger: vaultRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        },
        y: 60,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: 'power3.out'
      })

      // Invisible Layer - Full Screen Reveal
      gsap.from('.invisible-statement', {
        scrollTrigger: {
          trigger: invisibleRef.current,
          start: 'top 70%',
          toggleActions: 'play none none reverse'
        },
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power2.out'
      })

      // Real People - Parallax Cards
      gsap.utils.toArray('.parallax-card').forEach((card: any, index: number) => {
        const speed = index % 2 === 0 ? 50 : -50
        gsap.to(card, {
          y: speed,
          scrollTrigger: {
            trigger: card,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1
          }
        })

        gsap.from(card, {
          scrollTrigger: {
            trigger: card,
            start: 'top 85%',
            toggleActions: 'play none none reverse'
          },
          x: index % 2 === 0 ? -100 : 100,
          opacity: 0,
          duration: 1,
          ease: 'power3.out'
        })
      })

      // Always On - Split Screen Sync
      gsap.from('.always-on-text', {
        scrollTrigger: {
          trigger: alwaysOnRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        },
        x: -50,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power2.out'
      })

      gsap.from('.always-on-visual', {
        scrollTrigger: {
          trigger: alwaysOnRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        },
        x: 50,
        opacity: 0,
        duration: 1,
        ease: 'power2.out'
      })

      // Under the Hood - Horizontal Scroll
      if (hoodRef.current && hoodTrackRef.current) {
        const track = hoodTrackRef.current
        const scrollWidth = track.scrollWidth
        const winWidth = window.innerWidth

        if (scrollWidth > winWidth) {
          gsap.to(track, {
            x: () => -(scrollWidth - winWidth),
            ease: 'none',
            scrollTrigger: {
              trigger: hoodRef.current,
              pin: true,
              scrub: 1,
              end: () => '+=' + (scrollWidth - winWidth),
              invalidateOnRefresh: true
            }
          })
        }
      }

    })

    return () => ctx.revert()
  }, [])

  return (
    <div className="landing-container">
      <ThreeBackground />

      {/* Navigation */}
      <div className="nav-wrapper">
        <nav className="nav-floating">
          <div className="logo-container">
            <img src={logoLight} alt="SafeKey" className="logo-image" />
            <span className="logo-text">SafeKey</span>
          </div>

          <div className="nav-center-links">
            {/* <a href="#features" className="nav-link">Features</a>
            <a href="#security" className="nav-link">Security</a> */}
            {/* <a href="https://github.com" target="_blank" rel="noreferrer" className="nav-link">GitHub</a> */}
          </div>

          <div className="nav-right-actions">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="nav-link">GitHub</a>
            <button onClick={() => navigate('/login')} className="btn-nav-cta">
              Launch App
            </button>
          </div>
        </nav>
      </div>

      {/* Hero Section */}
      <section ref={heroRef} className="hero-new">
        <div className="hero-glow-bg"></div>

        <div className="hero-content-centered">
          <div className="hero-badge-pill hero-text-anim">
            <span className="badge-dot"></span> v0.1 Beta
          </div>

          <h1 className="hero-title-large hero-text-anim">
            Encrypted locally,<br />
            <span className="highlight-gradient">available globally.</span>
          </h1>

          <p className="hero-sub-text hero-text-anim">
            The decentralized password manager that feels human.<br />
            Secure your digital life without the complexity.
          </p>

          <div className="hero-cta-group hero-text-anim">
            <button onClick={() => navigate('/login')} className="btn-primary-glow">
              Create Vault
            </button>
            <a className="btn-secondary-glass" href="#how-it-works">
              How it works
            </a>
          </div>
        </div>

        {/* Floating Feature Cards */}
        <div className="floating-card card-top-left">
          <div className="float-icon-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <div className="float-content">
            <span className="float-label">Zero Knowledge</span>
            <span className="float-sub">Only you have the keys</span>
          </div>
        </div>

        <div className="floating-card card-bottom-right">
          <div className="float-icon-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
          </div>
          <div className="float-content">
            <span className="float-label">Instant Sync</span>
            <span className="float-sub">Across all devices</span>
          </div>
        </div>

        <div className="floating-card card-top-right">
          <div className="float-icon-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          </div>
          <div className="float-content">
            <span className="float-label">Sui Network</span>
            <span className="float-sub">Decentralized Security</span>
          </div>
        </div>
      </section>

      {/* How You Use It - Stepped Flow */}
      <section ref={howRef} className="how-section" id="how-it-works">
        <div className="section-container-center">
          <h2 className="section-title-center">How You Use It</h2>
          <p className="section-sub-center">Feels simple from the first tap.</p>

          <div className="how-flow">
            <div className="flow-step">
              <div className="flow-number">01</div>
              <div className="flow-content">
                <h3>Sign in with Google</h3>
                <p>You're in instantly. No setup, no recovery phrase.</p>
              </div>
            </div>

            <div className="flow-arrow">→</div>

            <div className="flow-step">
              <div className="flow-number">02</div>
              <div className="flow-content">
                <h3>Save as you browse</h3>
                <p>Extension detects logins and stores them securely.</p>
              </div>
            </div>

            <div className="flow-arrow">→</div>

            <div className="flow-step">
              <div className="flow-number">03</div>
              <div className="flow-content">
                <h3>Autofill when you return</h3>
                <p>Right credential at the right moment.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Your Vault - Split Layout (Bento + Dashboard) */}
      <section ref={vaultRef} className="vault-section-split">
        <div className="vault-container-split">
          {/* Left Side - Feature Cards (Bento Grid) */}
          <div className="vault-content-left">
            <div className="vault-header-left">
              <h2 className="section-title-left">Your Vault</h2>
              <p className="section-sub-left">All your credentials, organized and secure.</p>
            </div>

            <div className="vault-bento-grid">
              {/* Large Card */}
              <div className="bento-card large">
                <div className="bento-icon-wrapper">
                  <div className="sync-arrow"></div>
                  <div className="sync-arrow reverse"></div>
                </div>
                <div className="bento-text">
                  <h3>One vault everywhere</h3>
                  <p>Syncs instantly across all your devices. Your passwords are always with you.</p>
                </div>
              </div>

              {/* Medium Card */}
              <div className="bento-card medium">
                <div className="bento-icon-wrapper">
                  <div className="account-circle"></div>
                  <div className="account-circle"></div>
                </div>
                <div className="bento-text">
                  <h3>Multi-account</h3>
                  <p>Handle multiple logins easily.</p>
                </div>
              </div>

              {/* Medium Card */}
              <div className="bento-card medium">
                <div className="bento-icon-wrapper">
                  <div className="search-circle"></div>
                  <div className="search-handle"></div>
                </div>
                <div className="bento-text">
                  <h3>Instant Search</h3>
                  <p>Find any key in milliseconds.</p>
                </div>
              </div>

              {/* Wide Card */}
              <div className="bento-card wide">
                <div className="bento-icon-wrapper">
                  <div className="shield-shape"></div>
                  <div className="shield-check"></div>
                </div>
                <div className="bento-text">
                  <h3>End-to-End Encrypted</h3>
                  <p>Your data is encrypted locally. We can't see it, hackers can't steal it.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Dashboard Visual */}
          <div className="vault-visual-right">
            <div className="dashboard-mockup">
              {/* Sidebar */}
              <div className="dash-sidebar">
                <div className="dash-controls">
                  <div className="dash-dot red"></div>
                  <div className="dash-dot yellow"></div>
                  <div className="dash-dot green"></div>
                </div>
                <div className="dash-nav">
                  <div className="dash-nav-item active">
                    <div className="nav-icon-box"></div>
                    <div className="nav-line"></div>
                  </div>
                  <div className="dash-nav-item">
                    <div className="nav-icon-box"></div>
                    <div className="nav-line short"></div>
                  </div>
                  <div className="dash-nav-item">
                    <div className="nav-icon-box"></div>
                    <div className="nav-line"></div>
                  </div>
                </div>
                <div className="dash-user-bottom">
                  <div className="user-circle"></div>
                </div>
              </div>

              {/* Main Content */}
              <div className="dash-main">
                <div className="dash-header">
                  <div className="dash-search-bar">
                    <div className="dash-search-icon"></div>
                    <div className="dash-search-text"></div>
                  </div>
                  <div className="dash-add-btn">+</div>
                </div>

                <div className="dash-list">
                  {/* Item 1 */}
                  <div className="dash-row">
                    <div className="dash-row-icon google-colors">G</div>
                    <div className="dash-row-content">
                      <div className="dash-row-title">Google</div>
                      <div className="dash-row-sub">user@gmail.com</div>
                    </div>
                    <div className="dash-arrow-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                  </div>
                  {/* Item 2 */}
                  <div className="dash-row">
                    <div className="dash-row-icon netflix-color">N</div>
                    <div className="dash-row-content">
                      <div className="dash-row-title">Netflix</div>
                      <div className="dash-row-sub">my.email@netflix.com</div>
                    </div>
                    <div className="dash-arrow-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                  </div>
                  {/* Item 3 */}
                  <div className="dash-row">
                    <div className="dash-row-icon spotify-color">S</div>
                    <div className="dash-row-content">
                      <div className="dash-row-title">Spotify</div>
                      <div className="dash-row-sub">music.lover@spotify.com</div>
                    </div>
                    <div className="dash-arrow-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                  </div>
                  {/* Item 4 */}
                  <div className="dash-row">
                    <div className="dash-row-icon github-color">G</div>
                    <div className="dash-row-content">
                      <div className="dash-row-title">GitHub</div>
                      <div className="dash-row-sub">dev.user@github.com</div>
                    </div>
                    <div className="dash-arrow-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Invisible Layer - Simple Centered */}
      {/* <section ref={invisibleRef} className="invisible-section-simple">
        <div className="section-container-center">
          <h2 className="section-title-center">The Invisible Layer</h2>
          <p className="section-sub-center">SafeKey handles the heavy parts quietly.</p>

          <div className="simple-list">
            <div className="simple-item">
              <span className="cross-icon">✕</span>
              <span>No seed phrases</span>
            </div>
            <div className="simple-item">
              <span className="cross-icon">✕</span>
              <span>No gas screens</span>
            </div>
            <div className="simple-item">
              <span className="cross-icon">✕</span>
              <span>No new habits to learn</span>
            </div>
          </div>

          <p className="tagline-center">You just use your accounts. SafeKey does the rest.</p>
        </div>
      </section> */}

      {/* Built for Real People - Centered */}
      <section ref={realPeopleRef} className="centered-section">
        <div className="section-container-center">
          <h2 className="section-title-center">Built for Real People</h2>
          <p className="section-sub-center">SafeKey fits the way you already live online.</p>

          <div className="benefits-list">
            <div className="benefit-item">
              <h3>One tap login across devices</h3>
            </div>
            <div className="benefit-item">
              <h3>Smooth sync when hardware changes</h3>
            </div>
            <div className="benefit-item">
              <h3>Zero maintenance once you're set up</h3>
            </div>
          </div>

          <p className="ownership-statement">Ownership without complexity.</p>
        </div>
      </section>

      {/* Always On - Grid */}
      <section ref={alwaysOnRef} className="always-on-section-new dark">
        <div className="section-container-center">
          <h2 className="section-title-center">Always On. Never In Your Way.</h2>
          <p className="section-sub-center">SafeKey stays mostly invisible.</p>

          <div className="features-grid">
            <div className="grid-card">
              <div className="icon-circle">
                <div className="save-icon-simple"></div>
              </div>
              <h3>Saves</h3>
              <p>When you create a new login</p>
            </div>

            <div className="grid-card">
              <div className="icon-circle">
                <div className="lightning-icon"></div>
              </div>
              <h3>Fills</h3>
              <p>When you return</p>
            </div>

            <div className="grid-card">
              <div className="icon-circle">
                <div className="shield-icon-simple"></div>
              </div>
              <h3>Protects</h3>
              <p>Your vault every moment in between</p>
            </div>
          </div>

          <p className="tagline-center">Quiet, predictable, dependable.</p>
        </div>
      </section>

      {/* Under the Hood - Horizontal Scroll */}
      <section ref={hoodRef} className="horizontal-section">
        <div className="horizontal-header">
          <h2 className="section-title">Under the Hood</h2>
          <p className="section-sub">Scroll to explore the stack</p>
        </div>
        <div ref={hoodTrackRef} className="horizontal-track">

          {/* Panel 1: Sui */}
          <div className="hood-panel">
            <div className="panel-visual sui-visual">
              <div className="pulse-core"></div>
              <div className="pulse-ring"></div>
            </div>
            <div className="panel-text">
              <h3>Sui Network</h3>
              <p className="tag">The Ledger</p>
              <p>Your vault reference lives as an immutable object.</p>
            </div>
          </div>

          {/* Panel 2: Walrus */}
          <div className="hood-panel">
            <div className="panel-visual walrus-visual">
              <div className="grid-nodes">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="node-dot"></div>
                ))}
              </div>
            </div>
            <div className="panel-text">
              <h3>Walrus Storage</h3>
              <p className="tag">The Vault</p>
              <p>Distributed, durable storage for your encrypted credentials.</p>
            </div>
          </div>

          {/* Panel 3: zkLogin */}
          <div className="hood-panel">
            <div className="panel-visual zk-visual">
              <div className="zk-lock"></div>
            </div>
            <div className="panel-text">
              <h3>zkLogin</h3>
              <p className="tag">The Key</p>
              <p>Sign in with Google. Zero-knowledge keeps it private.</p>
            </div>
          </div>

          {/* Panel 4: SEAL */}
          <div className="hood-panel">
            <div className="panel-visual seal-visual">
              <div className="shield-outer">
                <div className="shield-inner"></div>
              </div>
            </div>
            <div className="panel-text">
              <h3>SEAL</h3>
              <p className="tag">The Shield</p>
              <p>Immutable rules protecting every session.</p>
            </div>
          </div>

        </div>
      </section>

      {/* Beta Access */}
      <section ref={betaRef} className="beta-section">
        <div className="beta-content">
          <div className="pricing-badge">Limited Time</div>
          <div className="pricing-header">
            <h2 className="pricing-title">Early Access</h2>
            <p className="pricing-subtitle">Join the revolution of decentralized security.</p>
          </div>

          <div className="pricing-price-container">
            <div className="price-original">
              <span className="currency">SUI</span>
              <span className="amount">X.00</span>
              <span className="period">/mo</span>
            </div>
            <div className="price-current">
              <span className="amount">0</span>
              <div className="price-meta">
                <span className="currency">SUI</span>
                <span className="period">/month</span>
              </div>
            </div>
          </div>

          <div className="pricing-features">
            <div className="feature-item">
              <span className="check-icon">✓</span>
              <span>Unlimited Passwords</span>
            </div>
            <div className="feature-item">
              <span className="check-icon">✓</span>
              <span>Cross-Device Sync</span>
            </div>
            <div className="feature-item">
              <span className="check-icon">✓</span>
              <span>Zero-Knowledge Encryption</span>
            </div>
            <div className="feature-item">
              <span className="check-icon">✓</span>
              <span>Priority Support</span>
            </div>
          </div>

          <button onClick={() => navigate('/login')} className="btn-pricing-cta">
            Start Your Journey
          </button>

          {/* <p className="pricing-note">No credit card required.</p> */}
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="footer-content">
          <div className="footer-left">
            <div className="logo">SafeKey</div>
            <p>© 2025 SafeKey</p>
          </div>
          <div className="footer-right">
            <a href="#">Twitter</a>
            <a href="#">Discord</a>
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
