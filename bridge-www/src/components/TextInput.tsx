export interface TextInputProps {
    onChange: (value: string) => void,
    value?: string,
}

export const TextInput: React.FC<TextInputProps> = ({ onChange, ...others }) => {
    return (
        <input type="text" onChange={event => { onChange(event.target.value) }} {...others} />
    )
}
