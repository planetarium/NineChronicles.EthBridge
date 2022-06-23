import { randomId } from "../random";

export interface TextInputProps {
    onChange: (value: string) => void,
    value?: string,
    label: string,
}

export const TextField: React.FC<TextInputProps> = ({ onChange, label, ...others }) => {
    const id = randomId();
    return (
        <div>
            <label htmlFor={id}>{label}</label>
            <input id={id} type="text" onChange={event => { onChange(event.target.value) }} {...others} />
        </div>
    )
}
