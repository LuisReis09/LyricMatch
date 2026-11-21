import { forwardRef, useState } from "react";
import "../css/utils/input.css"

interface TextInput_Params{
    label?: string,
    placeholder?: string,
    value?: string,
    setText?: (text: string) => void
    enterFunc?: () => void
    isPassword?: boolean
}

const TextInput = forwardRef<HTMLInputElement, TextInput_Params>(({label, placeholder, setText, value, enterFunc, isPassword}, ref) => {
    const [showPassword, setShowPassword] = useState<boolean>(isPassword ? true : false);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            if (enterFunc) {
                enterFunc();
            }
        }
    }

    const handleShowPassword = (newVal: boolean) => {
        setShowPassword(newVal);
    }

    return(
        <div className="input_box" id="text_input_box">
            {
                label &&
                <label className="text_input_label">{label}</label>
            }
            <input
                    ref={ref}
                    {...(showPassword ? {type: "password"} : {type: "text"})}
                    className="text_input"
                    onChange={(e) => setText && setText(e.target.value)} 
                    placeholder = {placeholder}
                    onKeyDown={handleKeyDown}
                    // autoComplete="off"
                    value={value}
            />

            {isPassword && 
                (
                    showPassword ? 
                    <div className="password_show">
                        <button className="show_password" onClick={() => handleShowPassword(false)}>
                            <i className="fa fa-eye"></i>
                        </button>
                    </div>
                    :
                    <div className="password_show">
                        <button className="show_password" onClick={() => handleShowPassword(true)}>
                            <i className="fa fa-eye-slash"></i>
                        </button>
                    </div>
                )
            }
        </div>
    )
});

TextInput.displayName = "TextInput";

export default TextInput
