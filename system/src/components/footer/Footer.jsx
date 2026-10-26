import { Link } from "react-router-dom";

function Footer() {
  return (
    <div className="Footer">
      <div className="Footer-Data">
        {/* 🔹 Social Media */}
        <div className="Footer-Medias">
          <a
            href="https://www.facebook.com/profile.php?id=61573235236277"
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>
          <a
            href="https://www.instagram.com/coze.kouzi?igsh=NmliZDB0MGRqZWx2"
            target="_blank"
            rel="noreferrer"
          >
            Instagram
          </a>
          <a href="mailto:omarkouzi81248@gmail.com">Gmail</a>
        </div>

        {/* 🔹 Legal */}
        <div className="Footer-Privacy">
          <Link to="/privacy-policy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </div>

      <p
        style={{
          opacity: "0.5",
          marginTop: "10px",
        }}
      >
        © 2026 Your Company. All rights reserved.
      </p>
    </div>
  );
}

export default Footer;
