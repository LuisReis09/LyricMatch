import '../../css/utils/avatars.css';
import React from 'react';
import ReactDOM from 'react-dom';

interface AvatarsProps {
    setAvatarsOpenMenu: (value: boolean) => void;
    avatarOpenMenu: boolean;
    setAvatar: (value: string) => void;
}

const avatars = Array.from({length: 50}, (_, i) => `/avatars/avatar${i + 1}.png`);

const Avatars: React.FC<AvatarsProps> = ({setAvatar, avatarOpenMenu, setAvatarsOpenMenu}) => {

    const selectAvatar = (avatar: string) => {
        setAvatar(avatar);
        setAvatarsOpenMenu(false);
    }

    if (!avatarOpenMenu) return null;

    return ReactDOM.createPortal(
        <div id='background_avatar_menu'>
            <div className="avatars_selection_box">
                <div id="avatar_menu_close" onClick={() => setAvatarsOpenMenu(false)}></div>
                <div id="avatar_menu_list">
                    {
                        avatars.map((avatar: string, index: number) => (
                            <button key={avatar}
                                type="button"
                                className="avatar_item" 
                                onClick={() => selectAvatar(avatar)}
                                aria-label={`Choose avatar ${index + 1}`}
                            >
                                <img
                                    src={`/avatars/thumbs/avatar${index + 1}.webp`}
                                    alt=""
                                    loading={index < 10 ? "eager" : "lazy"}
                                    decoding="async"
                                />
                            </button>
                        ))
                    }
                    
                </div>
            </div>
        </div>
        , document.body
    );
}

export default Avatars;
