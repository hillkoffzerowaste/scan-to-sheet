import React, { useEffect, useRef, useState } from 'react';

// เมนูบาร์แบบ Windows — ทุกรายการต้องผูกกับคำสั่งที่มีอยู่จริงในแอปแล้วเท่านั้น
// ห้ามใส่รายการที่ยังไม่มีโค้ดรองรับ เพราะเมนูที่กดแล้วไม่เกิดอะไรคือบั๊กในสายตาผู้ใช้
function MenuBar({ menus }) {
  const [openMenu, setOpenMenu] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    if (!openMenu) return () => {};
    const closeOnOutside = (event) => {
      if (!barRef.current?.contains(event.target)) setOpenMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

  return (
    <div className="win-menubar" ref={barRef}>
      {menus.map((menu) => {
        const items = menu.items.filter(Boolean);
        if (items.length === 0) return null;
        const isOpen = openMenu === menu.label;
        return (
          <div className="win-menu" key={menu.label}>
            <button
              className={`win-menu-title ${isOpen ? 'open' : ''}`}
              type="button"
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={() => setOpenMenu(isOpen ? null : menu.label)}
              // เลื่อนเมาส์ข้ามหัวข้อแล้วสลับเมนูได้เมื่อมีเมนูเปิดอยู่ ตามพฤติกรรมของโปรแกรมบน Windows
              onMouseEnter={() => { if (openMenu) setOpenMenu(menu.label); }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="win-menu-pop" role="menu">
                {items.map((item, index) => (
                  item.separator ? (
                    <hr key={`sep-${index}`} />
                  ) : item.href ? (
                    <a
                      key={item.label}
                      role="menuitem"
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpenMenu(null)}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <button
                      key={item.label}
                      role="menuitem"
                      type="button"
                      disabled={item.disabled}
                      onClick={() => { setOpenMenu(null); item.onSelect?.(); }}
                    >
                      {item.label}
                    </button>
                  )
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MenuBar;
