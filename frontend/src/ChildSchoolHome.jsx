import { useState, useEffect } from 'react';
import { GraduationCap, BookOpen, Users, Phone, MapPin, Mail, ArrowRight } from 'lucide-react';

export default function ChildSchoolHome({ onLogin }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div>
      <nav className={`home-nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-inner">
          <div className="logo"><GraduationCap size={28} /> Bright Future Primary School</div>
          <button className="login-btn" onClick={onLogin}><ArrowRight size={16} /> Admin Login</button>
        </div>
      </nav>

      <section className="hero-section">
        <div className="hero-content">
          <h1>Welcome to Bright Future Primary School</h1>
          <p>Nurturing young minds with quality education, modern facilities, and a caring environment.</p>
          <button className="cta-btn" onClick={onLogin}><ArrowRight size={18} /> Enter Admin Panel</button>
        </div>
      </section>

      <section className="features-section">
        <h2>Why Choose Us</h2>
        <div className="features-grid">
          <div className="feature-card"><BookOpen size={32} /><h3>Quality Education</h3><p>Experienced teachers and comprehensive curriculum.</p></div>
          <div className="feature-card"><Users size={32} /><h3>Small Class Sizes</h3><p>Individual attention for every student.</p></div>
          <div className="feature-card"><GraduationCap size={32} /><h3>Holistic Development</h3><p>Academics, sports, arts, and character building.</p></div>
        </div>
      </section>

      <section className="contact-section">
        <h2>Contact Us</h2>
        <div className="contact-grid">
          <div className="contact-item"><MapPin size={20} /> 123 School Road, City</div>
          <div className="contact-item"><Phone size={20} /> +91 98765 43210</div>
          <div className="contact-item"><Mail size={20} /> info@brightfuture.edu</div>
        </div>
      </section>

      <footer className="home-footer">
        &copy; {new Date().getFullYear()} Bright Future Primary School. All rights reserved.
      </footer>
    </div>
  );
}
