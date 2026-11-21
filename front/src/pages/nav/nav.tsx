/*
    This module is responsible for containing the nav bar, 
    which contains the home screen menu icons (in the left corner) and the logo (in the right corner).
*/
import React from 'react'
import { Link } from 'react-router-dom'
import '../../css/initialpages/nav.css'

const Nav: React.FC = () => {
    return (
        <nav aria-label="Primary navigation">
            <div id = "nav_bar">
                <Link to="/" id="logo_icon" aria-label="Lyric Match home" />
                <div className="home_nav_links">
                    <Link to="/" className="home_nav_link">Home</Link>
                    <Link to="/aboutgame" className="home_nav_link">How to play</Link>
                    <Link to="/about" className="home_nav_link">About us</Link>
                </div>
            </div>
        </nav>
    )
}


export default Nav
