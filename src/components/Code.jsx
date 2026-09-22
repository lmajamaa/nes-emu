import React from 'react';

const Code = ({ pc, mapAsm }) => {

    // // Keep latest props in a ref.
    // let latestProps = useRef(props);
    // useEffect(() => {
    //     latestProps.current = props;
    // });

    // useEffect(() => {
    //     function tick() {
    //         // Read latest props at any time
    //         console.log(latestProps.current);
    //     }

    //     const id = setInterval(tick, 1000);
    //     return () => clearInterval(id);
    // }, []); // This effect never re-runs

    const items = [];

    for (let i = pc - 25; i < pc; i++) {
        let it_a = mapAsm[i];
        if (it_a) {
            items.push(<code key={it_a}>{it_a}<br /></code>)
        }
    }

    for (let i = pc; i <= pc + 25; i++) {
        let it_a = mapAsm[i];
        if (it_a) {
            items.push(<code className={i === pc ? 'current' : null} key={it_a}>{it_a}<br /></code>)
        }
    }

    return (
        <div className="codeArea">
            {items}
        </div>
    )
};

export default Code;