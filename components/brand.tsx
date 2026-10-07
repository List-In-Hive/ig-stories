export default function Brand() {
  return (
    <span className="brand" aria-label="Inspirovate Creatives Storyloom">
      <span className="brand-symbol">
        <img
          src="/brand/inspirovate-logo.jpg"
          alt="Inspirovate Creatives logo"
          width={48}
          height={48}
        />
      </span>
      <span className="brand-word">
        <span>
          INSPIROVATE
          <br />
          CREATIVES
        </span>
        <strong>
          Storyloom<span className="brand-dot">.</span>
        </strong>
      </span>
    </span>
  );
}
