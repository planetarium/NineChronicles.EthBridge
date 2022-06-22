export interface TextInputProps {
    onChange: (value: string) => void,
}

export const TextInput: React.FC<TextInputProps> = ({ onChange }) => {
    return (
        <input type="text" onChange={event => { onChange(event.target.value) }}/>
    )
}
