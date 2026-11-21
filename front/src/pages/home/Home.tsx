import { useState } from 'react';

import Enter from './Enter';
import Create from './Create';
import Avatars from './Avatars';
import TextInput from '../../utils/TextInput';
import { Link } from 'react-router-dom';
import '../../css/initialpages/home.css';

interface HomeProps {
    closeMenu: () => void;
}

const Home: React.FC<HomeProps> = ({closeMenu}) => {
    const [mode, setMode] = useState<"enter" | "create">("enter");
    const [username, setUsername] = useState<string>("");
    const [avatar, setAvatar] = useState<string>("/avatars/avatar1.png");
    const [openAvatarMenu, setOpenAvatarMenu] = useState<boolean>(false);

    function toggleToEnter() {
        setMode('enter');
    }

    function toggleToCreate() {
        setMode('create');
    }

    return(
        <main id='home' onClick={closeMenu}>
            <section className="home_intro" aria-labelledby="game_title">
                <span className="home_eyebrow">MUSIC • LYRICS • FRIENDS</span>
                <h1 id="game_title">Lyric <span>Match</span></h1>
                <p className="home_description">Find a song for the word, challenge your friends, and make every round count.</p>
                <div className="home_shortcuts">
                    <Link to="/aboutgame">How to play</Link>
                    <Link to="/about">Meet the team</Link>
                </div>
            </section>
            <div id="form_box">

                <div id="fixed_box">
                    <div className="form_heading">Ready to play?</div>

                    <div id="options_entry_box">
                        <button 
                            style={mode === 'enter' ? {backgroundColor: '#A4AC86'}: undefined} 
                            id="enter_option"  
                            className="option_entry" 
                            onClick={toggleToEnter}  
                            >Enter
                        </button>
                        <button 
                            style={mode === 'create' ? {backgroundColor: '#A4AC86'}: undefined}
                            id="create_option" 
                            className="option_entry" 
                            onClick={toggleToCreate} 
                            >Create
                        </button>
                    </div>

                    <div id="user_avatar_box">
                        <div id="edit_avatar" onClick={() => setOpenAvatarMenu(true)}>
                            <div id="edit_avatar_icon"></div>
                        </div>
                        <div id="user_avatar" style={{backgroundImage: `url(${avatar})`}}></div>
                    </div>
                    
                    <TextInput label="Nickname:" placeholder="Enter your nickname" setText={setUsername}/>
                </div> {/*fim de fixed_box*/}


                {mode === "enter" && <Enter username={username}  avatar={avatar}/>}
                {mode === "create" && <Create username={username}  avatar={avatar}/>}
            </div>

            {openAvatarMenu && <Avatars setAvatarsOpenMenu={setOpenAvatarMenu} avatarOpenMenu={openAvatarMenu}  setAvatar={setAvatar}/> }
        </main>
    )
}

export default Home
