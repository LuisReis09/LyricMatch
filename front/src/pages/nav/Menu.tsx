interface MenuProps {
    openMenu: boolean;
    setOpenMenu: (open: boolean) => void;
}

import React from 'react';
import ReactDOM from 'react-dom';
import { Link } from 'react-router-dom';
// import '../../css/initialpages/nav.css';
import '../../css/utils/menu.css'; // Import the CSS file for the menu


const Menu : React.FC<MenuProps> = ({openMenu, setOpenMenu}) => {
    return ReactDOM.createPortal(
        <>
            {openMenu && <button className="menu_backdrop" aria-label="Close menu" onClick={() => setOpenMenu(false)} />}
            <aside id="menu" className={openMenu ? "menu_opened" : "menu_closed"} aria-hidden={!openMenu}>
                <div className="menu_header">
                    <span className="menu_brand">LyricMatch</span>
                    <button id="menu_close_button" className="nav_items" type="button" aria-label="Close menu" onClick={() => setOpenMenu(false)} />
                </div>

                <nav id="menu_items_box" aria-label="Main navigation">
                    <Link className="menu_item" to="/"          tabIndex={openMenu ? 0 : -1} onClick={() => setOpenMenu(false)} >Home</Link>
                    <Link className="menu_item" to="/about"     tabIndex={openMenu ? 0 : -1} onClick={() => setOpenMenu(false)} >About us</Link>
                    <Link className="menu_item" to="/aboutgame" tabIndex={openMenu ? 0 : -1} onClick={() => setOpenMenu(false)} >About Game</Link>
                    {/* The dashboard is intentionally not a public menu item. */}
                </nav>

                <div id="bottom_items">
                    <p>Version 3.1</p>
                </div>
            </aside>
        </>, document.body
    )
}

export default Menu
