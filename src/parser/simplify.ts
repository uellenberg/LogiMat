import {create, all, MathNodeCommon, FunctionNode, MathNode} from "mathjs";
import {HandleName, isNumeric} from "./util";
import {builtinMultiArgs, builtinOneArg, builtinThreeArgs, builtinTwoArgs, builtinZeroArg, constants} from "./builtin";

const math = create(all);

//Disable conflicting functions.
for(const name of ["range"]) {
    if(math.hasOwnProperty(name)) delete math[name];
    if(math["expression"]["transform"].hasOwnProperty(name)) delete math["expression"]["transform"][name];
    if(math["expression"]["mathWithTransform"].hasOwnProperty(name)) delete math["expression"]["mathWithTransform"][name];
}

export const SimplifyExpression = (input: string, {useTex, strict, names, map, partialSimplify}: SimplifyData) : string => {
    // We're separating partial and non-partial simplifications in our map to prevent
    // a partial simplify from overriding a full simplify (or vice-versa).
    if(map.hasOwnProperty((partialSimplify ? "~" : "") + input) && !partialSimplify) return map[input];

    const newNames = names.concat(builtinNames);

    try {
        const res = math.simplify(input, simplifyRules, {}, {exactFractions: false});
        //They say they return a string but they can sometimes return numbers.
        const text = useTex ? res.toTex(getTexOptions(strict, newNames, partialSimplify)) : res.toString(getStringOptions(strict, newNames, partialSimplify));
        map[(partialSimplify ? "~" : "") + input] = text;

        return text;
    } catch(e) {
        console.error("An error has occurred while attempting to simplify \"" + input + "\":");
        throw e;
    }
}

export interface SimplifyData {
    useTex: boolean;
    strict: boolean;
    names: string[];
    map: Record<string, string>;
    partialSimplify: boolean;
}

const simplifyRules = [
    //Or
    "n | 1 -> 1",
    "1 | n -> 1",
    "n | 0 -> n",
    "0 | n -> n",
    //And
    "n & 1 -> n",
    "1 & n -> n",
    "n & 0 -> 0",
    "0 & n -> 0",
    //Multiplication,
    "n * 0 -> 0",
    "0 * n -> 0",
    "n * 1 -> n",
    "1 * n -> n",
    //Division,
    "n / 1 -> n",
    "n / 0 -> undef(n)",
    "Infinity -> inf()",
    //Func
    "if_func(0,n1,n2) -> n2",
    "if_func(1,n1,n2) -> n1",
    "if_func(n1,n2,n2) -> n2",
    "if_func(n1,if_func(n1,n2,n3),n4) -> if_func(n1,n2,n4)",
    "if_func(n1==0,n2,if_func(n1,n3,n4)) -> if_func(n1,n3,n2)",
    "if_func(n1,1,0) -> n1",
    //Point
    "point(n1,n2) + point(n3,n4) -> point(n1+n3,n2+n4)",
    "0 * point(n1,n2) -> point(0,0)",
    "1 * point(n1,n2) -> point(n1,n2)",
    "point(n1,n2) * 0 -> point(0,0)",
    "point(n1,n2) * 1 -> point(n1,n2)",
    "point(n1,n2) / 1 -> point(n1,n2)",
    //Exponents
    "pow(pow(n1,n2),n3) -> pow(n1,n2*n3)",
    //General Simplification
    "n1-+n2 -> n1-n2",
    "n1+-n2 -> n1-n2",
    "n1--n2 -> n1+n2",
    "n1++n2 -> n1+n2"
].concat(math.simplify["rules"] as string[]);

const HandleFunction = (node: FunctionNode, options: Options, builtIn: boolean = false) : string => {
    // WAIT: We need special handling for partialSimplify to not add unparsable syntax.
    if(options.partialSimplify) return node.fn.toString(options) + "(" + node.args.map(arg => arg.toString(options)).join(",") + ")";

    return (builtIn ? "\\operatorname{" : "") + node.fn.toString(options) + (builtIn ? "}" : "") + "\\left(" + node.args.map(arg => arg.toString(options)).join(",") + "\\right)";
}

const operatorMap = {
    "*": "*",
    "/": "*",
    "+": "+",
    "-": "+",
    "^": "^"
};

const handle = (node: MathNode, options: Options, tex: boolean) : string => {
    const encaseLogicalOperators = options.encaseLogicalOperators;
    options.encaseLogicalOperators = true;

    const secondaryBinary = options.secondaryBinary;
    options.secondaryBinary = false;

    //Handle numerical values.
    if(node.type === "ConstantNode" && !isNaN(node.value)) {
        return math.format(node.value, {notation: "fixed"});
    }

    //Handle default operators.
    if(node.type === "OperatorNode" && node.op) {
        if(node.fn?.startsWith("unary")) {
            if(node.args[0]?.type === "OperatorNode" && node.args[0]?.op) {
                return node.op + Encapsulate(HandleNode(node.args[0], options, tex), options.partialSimplify);
            }

            return node.op + HandleNode(node.args[0], options, tex);
        }

        let op = node.op;

        // WAIT: In order for partial simplifications to work, we can't handle special functions
        // unless we are instructed to.
        if(options.partialSimplify) return `(${HandleNode(node.args[0], options, tex)})${op}(${HandleNode(node.args[1], options, tex)})`;

        if(op === "|") {
            const opOptions = Object.assign({}, options);
            opOptions.secondaryBinary = true;
            opOptions.encaseLogicalOperators = false;

            const normalOptions = Object.assign({}, options);
            normalOptions.encaseLogicalOperators = false;

            let a1txt, a2txt, a1, a2;

            if(node.args[0].type === "OperatorNode" && node.args[0].op === "|") {
                a1txt = HandleNode(node.args[0], Object.assign({}, opOptions), tex);
                a1 = a1txt;
            } else {
                a1txt = HandleNode(node.args[0], Object.assign({}, normalOptions), tex);
                a1 = a1txt + (node.args[0].type !== "OperatorNode" ? "=1" : "");
            }

            if(node.args[1].type === "OperatorNode" && node.args[1].op === "|") {
                a2txt = HandleNode(node.args[1], Object.assign({}, opOptions), tex);
                a2 = a2txt;
            } else {
                a2txt = HandleNode(node.args[1], Object.assign({}, normalOptions), tex);
                a2 = a2txt + (node.args[1].type !== "OperatorNode" ? "=1" : "");
            }

            if(a1txt === "1" || a2txt === "1") {
                return "1";
            }

            if(!secondaryBinary) {
                if(encaseLogicalOperators) {
                    return `\\left\\{${a1},${a2},0\\right\\}`;
                }

                return `\\left\\{${a1},${a2},0\\right\\}=1`;
            }

            return `${a1},${a2}`;
        }

        if(op === "&") {
            const opOptions = Object.assign({}, options);
            opOptions.secondaryBinary = true;
            opOptions.encaseLogicalOperators = false;

            const normalOptions = Object.assign({}, options);
            normalOptions.encaseLogicalOperators = false;

            let a1txt, a2txt, a1, a2;

            if(node.args[0].type === "OperatorNode" && node.args[0].op === "&") {
                a1txt = HandleNode(node.args[0], Object.assign({}, opOptions), tex);
                a1 = a1txt;
            } else {
                a1txt = HandleNode(node.args[0], Object.assign({}, normalOptions), tex);
                a1 = "\\left\\{" + a1txt + (node.args[0].type !== "OperatorNode" ? "=1" : "") + "\\right\\}";
            }

            if(node.args[1].type === "OperatorNode" && node.args[1].op === "&") {
                a2txt = HandleNode(node.args[1], Object.assign({}, opOptions), tex);
                a2 = a2txt;
            } else {
                a2txt = HandleNode(node.args[1], Object.assign({}, normalOptions), tex);
                a2 = "\\left\\{" + a2txt + (node.args[1].type !== "OperatorNode" ? "=1" : "") + "\\right\\}";
            }

            if(a1txt === "0" || a2txt === "0") {
                return "0";
            }

            if(!secondaryBinary) {
                if(encaseLogicalOperators) {
                    return `${a1}${a2}`;
                }

                return `${a1}${a2}=1`;
            }

            return `${a1}${a2}`;
        }

        if(op === "!=") {
            node.op = "=";
            node.args = [node.args[1], node.args[0]];
            return functions["if_func"](<FunctionNode>{args: [node, {value: 0}, {value: 1}]}, options, tex);
        }

        let a1 = HandleNode(node.args[0], options, tex);
        let a2 = HandleNode(node.args[1], options, tex);

        const pA1 = parseFloat(a1);
        const pA2 = parseFloat(a2);
        const a1Numeric = isNumeric(a1);
        const a2Numeric = isNumeric(a2);
        const numeric = a1Numeric && a2Numeric;

        //Handle logical operators.
        if(["==", ">", ">=", "<", "<="].includes(op)) {
            switch(op) {
                case "==":
                    op = "=";

                    if(numeric) return pA1 === pA2 ? "1" : "0";
                    break;
                case ">":
                    if(numeric) return pA1 > pA2 ? "1" : "0";
                    break;
                case ">=":
                    op = "\\ge ";

                    if(numeric) return pA1 >= pA2 ? "1" : "0";
                    break;
                case "<":
                    if(numeric) return pA1 < pA2 ? "1" : "0";
                    break;
                case "<=":
                    op = "\\le ";

                    if(numeric) return pA1 <= pA2 ? "1" : "0";
                    break;
            }

            if(encaseLogicalOperators) {
                return `\\left\\{${a1}${op}${a2},0\\right\\}`;
            }

            return `${a1}${op}${a2}`;
        }

        //Handle special cases like a+-b to a-b and a*b to ab.
        if(a2.startsWith("-") && operatorMap[node.op] === "+") {
            a2 = a2.substring(1);

            if(node.op === "+") {
                op = "-";
            } else {
                op = "+";
            }
        }

        //If any of the ones here are an incompatible operation, encapsulate them.

        const operator = node.op;
        const op1 = node.args[0].type === "OperatorNode" ? node.args[0].op : null;
        const op2 = node.args[1].type === "OperatorNode" ? node.args[1].op : null;

        //We want to group any non-single terms that have an operator that isn't equal to the current operator.
        //Division is the one exception, where we don't need to use parentheses.
        if(!IsSingleTerm(op1) && op1 !== operator && node.op !== "/") {
            a1 = Encapsulate(a1, options.partialSimplify);
        }
        if(!IsSingleTerm(op2) && op2 !== operator && node.op !== "/") {
            a2 = Encapsulate(a2, options.partialSimplify);
        }

        switch(op) {
            case "/":
                return `\\frac{${a1}}{${a2}}`;
            case "^":
                if((node.args[0].type === "FunctionNode" && typeof(node.args[0].fn) === "object" && node.args[0].fn["name"] === "pow") || /[-+*/]/g.test(a1)) {
                    a1 = Encapsulate(a1, options.partialSimplify);
                }

                return `{${a1}}^{${a2}}`
            case "*":
            {
                //Explicit * is only required between two numbers or when an array is involved.
                //If both start with a digit, and at least one actually is one, we'll consider it to be numeric.
                //This fits the case of n*n, and also n*n^n.
                //It ignores n^n*n^n, however, which is what we want.
                const digitRegex = /^{*\d/;

                const isDigit = (a1Numeric || a2Numeric) && digitRegex.test(a1) && digitRegex.test(a2);
                const isArray = (node.args[0].type === "FunctionNode" && typeof(node.args[0].fn) === "object" && node.args[0].fn["name"] === "array") || (node.args[1].type === "FunctionNode" && typeof(node.args[1].fn) === "object" && node.args[1].fn["name"] === "array");
                if(isDigit || isArray) return `${a1}\\cdot${a2}`;
                return `${a1}${a2}`;
            }
            default:
                return `${a1}${op}${a2}`;
        }
    }

    //Handle functions.
    if(node.type === "FunctionNode" && typeof(node.fn) === "object" && node.fn["name"]) {
        let name: string = node.fn["name"];

        //If we can simplify the function, do so.
        if(simplification.hasOwnProperty(name)) {
            const simplified = simplification[name](node, options, tex);
            if(simplified != null) return simplified;
        }

        // WAIT: In order for partial simplifications to work, we can't handle special functions
        // unless we are instructed to.
        if(options.partialSimplify) return HandleFunction(node, options);

        //If we have tex-only special handling for it, then handle it.
        if(tex && texFunctions.hasOwnProperty(name)) {
            return texFunctions[name](node, options);
        }

        //If we have special handling for it, then handle it.
        if(functions.hasOwnProperty(name)) {
            return functions[name](node, options, tex);
        }

        //If we know it's a built-in constant, handle it.
        if(constants.includes(name)) {
            return `\\${name} `;
        }

        //If it's a built-in function, handle it.
        if(
            (node.args.length === 0 && builtinZeroArg.includes(name)) ||
            (node.args.length === 1 && builtinOneArg.includes(name)) ||
            (node.args.length === 2 && builtinTwoArgs.includes(name)) ||
            (node.args.length === 3 && builtinThreeArgs.includes(name)) ||
            builtinMultiArgs.includes(name)
        ) {
            if(tex) {
                return `\\operatorname{${name}}\\left(${node.args.map(arg => arg.toTex(options)).join(",")}\\right)`
            }

            return HandleFunction(node, options, true);
        }

        if(options.strict && !options.names.includes(name)) {
            throw new Error("The function \"" + name + "\" does not exist.");
        }

        if(tex) {
            return (<MathNodeCommon><unknown>node.fn).toTex(options) + "\\left(" + node.args.map(arg => arg.toTex(options)).join(",\\ ") + "\\right)";
        }

        return HandleFunction(node, options);
    }

    //Handle variables.
    if(node.type === "SymbolNode") {
        // WAIT: In order for partial simplifications to work, we can't handle special functions
        // unless we are instructed to. We can also leave strict checking to the full simplify.
        if(options.partialSimplify) return node.name;

        if(options.strict && !options.names.includes(node.name)) {
            throw new Error("The function or variable \"" + node.name + "\" does not exist.");
        }

        //Correct the variable name if it's in the form of \w_\w+.
        return HandleName(node.name);
    }

    return "";
}

const IsSingleTerm = (op: string) : boolean => {
    //Single terms are implicitly grouped, and don't need parentheses.
    return !op || operatorMap[op] !== "+";
}

const Encapsulate = (val: string, partialSimplify: boolean) : string => {
    // WAIT: To prevent partial simplifications from breaking, we can
    // only use latex if it's disabled.
    return partialSimplify ? `(${val})` : `\\left(${val}\\right)`;
}

const HandleNode = (node: MathNodeCommon, options: object, tex: boolean) : string => {
    if(!node) return "";
    //They say they return a string but they can sometimes return numbers.
    return tex ? node.toTex(options).toString() : node.toString(options).toString();
}

const getStringOptions = (strict: boolean, names: string[], partialSimplify: boolean) : Options => {
    return {
        handler(node, options) {
            return handle(node, options, false);
        },
        strict,
        names,
        partialSimplify,
        encaseLogicalOperators: true,
        secondaryBinary: false
    };
}

const getTexOptions = (strict: boolean, names: string[], partialSimplify: boolean) : Options => {
    return {
        handler(node, options) {
            return handle(node, options, true);
        },
        strict,
        names,
        partialSimplify,
        encaseLogicalOperators: true,
        secondaryBinary: false
    };
}

interface Options {
    handler: (node: any, options: Options) => string;
    strict: boolean;
    names: string[];
    partialSimplify: boolean;
    encaseLogicalOperators: boolean;
    secondaryBinary: boolean;
}

const simplification: Record<string, (node: FunctionNode, options: Options, tex: boolean) => string | null> = {
    array_idx(node, options, tex) {
        const handledIndexer = HandleNode(node.args[1], options, tex);
        const indexer = parseInt(handledIndexer);

        //If the indexer is a number and the array is an array (and not a variable), we can simplify it.
        if(isNumeric(handledIndexer) && node.args[0]?.type === "FunctionNode" && typeof(node.args[0]?.fn) === "object" && node.args[0]?.fn["name"] === "array") {
            const handled = HandleNode(node.args[0].args[indexer-1], options, tex);

            if(node.args[0].args[indexer-1].type === "OperatorNode") return Encapsulate(handled, options.partialSimplify);
            return handled;
        }

        return null;
    },
    point_x(node, options, tex) {
        //If the point is a point (and not a variable), we can simplify it.
        if(node.args[0]?.type === "FunctionNode" && typeof(node.args[0]?.fn) === "object" && node.args[0]?.fn["name"] === "point") {
            const handled = HandleNode(node.args[0].args[0], options, tex);

            if(node.args[0].args[0].type === "OperatorNode") return Encapsulate(handled, options.partialSimplify);
            return handled;
        }

        return null;
    },
    point_y(node, options, tex) {
        //If the point is a point (and not a variable), we can simplify it.
        if(node.args[0]?.type === "FunctionNode" && typeof(node.args[0]?.fn) === "object" && node.args[0]?.fn["name"] === "point") {
            const handled = HandleNode(node.args[0].args[1], options, tex);

            if(node.args[0].args[1].type === "OperatorNode") return Encapsulate(handled, options.partialSimplify);
            return handled;
        }

        return null;
    },
    pow(node, options, tex) {
        const handledBase = HandleNode(node.args[0], options, tex);
        const handledPower = HandleNode(node.args[1], options, tex);

        if(isNumeric(handledBase) && isNumeric(handledPower)) {
            return Math.pow(parseFloat(handledBase), parseFloat(handledPower)).toString();
        }

        return null;
    }
};

const functions: Record<string, (node: FunctionNode, options: Options, tex: boolean) => string> = {
    sum(node, options, tex) {
        const encapsulate = !(node.args[3].type === "FunctionNode" && typeof(node.args[3].fn) === "object" && ["sum", "prod", "int", "div"].includes(node.args[3].fn["name"]));

        return `\\left({\\sum_{${HandleNode(node.args[0], options, tex)}=${HandleNode(node.args[1], options, tex)}}^{${HandleNode(node.args[2], options, tex)}}{${encapsulate ? "\\left(" : ""}${HandleNode(node.args[3], options, tex)}${encapsulate ? "\\right)" : ""}}}\\right)`;
    },
    prod(node, options, tex) {
        const encapsulate = !(node.args[3].type === "FunctionNode" && typeof(node.args[3].fn) === "object" && ["sum", "prod", "int", "div"].includes(node.args[3].fn["name"]));

        return `\\left({\\prod_{${HandleNode(node.args[0], options, tex)}=${HandleNode(node.args[1], options, tex)}}^{${HandleNode(node.args[2], options, tex)}}{${encapsulate ? "\\left(" : ""}${HandleNode(node.args[3], options, tex)}${encapsulate ? "\\right)" : ""}}}\\right)`;
    },
    int(node, options, tex) {
        const encapsulate = !(node.args[3].type === "FunctionNode" && typeof(node.args[3].fn) === "object" && ["sum", "prod", "int", "div"].includes(node.args[3].fn["name"]));

        return `\\left({\\int_{${HandleNode(node.args[1], options, tex)}}^{${HandleNode(node.args[2], options, tex)}}{${encapsulate ? "\\left(" : ""}${HandleNode(node.args[3], options, tex)}${encapsulate ? "\\right)" : ""}}d${HandleNode(node.args[0], options, tex)}}\\right)`;
    },
    div(node, options, tex) {
        const encapsulate = !(node.args[1].type === "FunctionNode" && typeof(node.args[1].fn) === "object" && ["sum", "prod", "int", "div"].includes(node.args[1].fn["name"]));

        return `\\left({{\\frac{d}{d${HandleNode(node.args[0], options, tex)}}}{${encapsulate ? "\\left(" : ""}${HandleNode(node.args[1], options, tex)}${encapsulate ? "\\right)" : ""}}}\\right)`
    },
    sqrt(node, options, tex) {
        return `\\sqrt{${HandleNode(node.args[0], options, tex)}}`;
    },
    pow(node, options, tex) {
        let base = HandleNode(node.args[0], options, tex);
        const exp = HandleNode(node.args[1], options, tex);

        if((node.args[0].type === "FunctionNode" && typeof(node.args[0].fn) === "object" && node.args[0].fn["name"] === "pow") || /[-+*/]/g.test(base)) {
            base = Encapsulate(base, options.partialSimplify);
        }

        return `{${base}}^{${exp}}`;
    },
    pi() {
        return "\\pi ";
    },
    inf() {
        return "\\infty ";
    },
    undef(node, options, tex) {
        return `\\frac{${HandleNode(node.args[0], options, tex)}}{0}`;
    },
    point(node, options, tex) {
        return `\\left(${node.args.map(arg => HandleNode(arg, options, tex)).join(",")}\\right)`;
    },
    array(node, options, tex) {
        return `[${node.args.map(arg => HandleNode(arg, options, tex)).join(",")}]`;
    },
    point_x(node, options, tex) {
        const point = HandleNode(node.args[0], options, tex);

        if(node.args[0].type === "OperatorNode") return `\\left(${point}\\right).x`;
        return `${point}.x`;
    },
    point_y(node, options, tex) {
        const point = HandleNode(node.args[0], options, tex);

        if(node.args[0].type === "OperatorNode") return `\\left(${point}\\right).y`;
        return `${point}.y`;
    },
    array_idx(node, options, tex) {
        const array = HandleNode(node.args[0], options, tex);
        const indexer = HandleNode(node.args[1], options, tex);

        if(node.args[0].type === "OperatorNode") return `\\left(${array}\\right)[${indexer}]`;
        return `${array}[${indexer}]`;
    },
    array_length(node, options, tex) {
        const array = HandleNode(node.args[0], options, tex);

        if(node.args[0].type === "OperatorNode") return `\\left(${array}\\right).\\operatorname{length}`;
        return `${array}.\\operatorname{length}`;
    },
    array_filter(node, options, tex) {
        const array = HandleNode(node.args[0], options, tex);
        const condition = HandleNode(node.args[1], options, tex);

        if(node.args[0].type === "OperatorNode") return `\\left(${array}\\right)[${condition}=1]`;
        return `${array}[${condition}=1]`;
    },
    array_map(node, options, tex) {
        const array = HandleNode(node.args[0], options, tex);
        const func = HandleNode(node.args[1], options, tex);
        const varName = HandleNode(node.args[2], options, tex);

        return `[${func}\\operatorname{for}${varName}=${array}]`;
    },
    range(node, options, tex) {
        const from = HandleNode(node.args[0], options, tex);
        const to = HandleNode(node.args[1], options, tex);

        return `[${from}...${to}]`;
    },
    equal(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}=${HandleNode(node.args[1], options, tex)},0\\right\\}`;
    },
    notEqual(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}=${HandleNode(node.args[1], options, tex)}:0,1\\right\\}`;
    },
    lt(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}<${HandleNode(node.args[1], options, tex)},0\\right\\}`;
    },
    lte(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}\\le ${HandleNode(node.args[1], options, tex)},0\\right\\}`;
    },
    gt(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}>${HandleNode(node.args[1], options, tex)},0\\right\\}`;
    },
    gte(node, options, tex) {
        return `\\left\\{${HandleNode(node.args[0], options, tex)}\\ge ${HandleNode(node.args[1], options, tex)},0\\right\\}`;
    },
    if_func(node, options: Options, tex) {
        const nonEnclosedOptions = Object.assign({}, options);
        nonEnclosedOptions.encaseLogicalOperators = false;

        const cond = HandleNode(node.args[0], nonEnclosedOptions, tex);
        const ifVal = HandleNode(node.args[1], options, tex);
        const elseVal = HandleNode(node.args[2], options, tex);

        if(cond === "1") return ifVal;
        if(cond === "0") return elseVal;
        if(ifVal === elseVal) return ifVal;

        return `\\left\\{${cond + (node.args[0].type !== "OperatorNode" ? "=1" : "")}${ifVal !== "1" ? `:${ifVal}` : ""},${elseVal}\\right\\}`;
    },
    log_base(node, options: Options, tex) {
        const base = HandleNode(node.args[0], options, tex);
        const value = HandleNode(node.args[1], options, tex);

        return `\\log_{${base}}(${value})`;
    }
};

const texFunctions: Record<string, (node: FunctionNode, options: object) => string> = {
    sum(node, options) {
        return `{\\sum_{${node.args[0].toTex(options)}=${node.args[1].toTex(options)}}^{${node.args[2].toTex(options)}}{\\left(${node.args[3].toTex(options)}\\right)}}`;
    },
    prod(node, options) {
        return `{\\prod_{${node.args[0].toTex(options)}=${node.args[1].toTex(options)}}^{${node.args[2].toTex(options)}}{\\left(${node.args[3].toTex(options)}\\right)}}`;
    },
    int(node, options) {
        return `{\\int_{${node.args[1].toTex(options)}}^{${node.args[2].toTex(options)}}{\\left(${node.args[3].toTex(options)}\\right)}d${node.args[0].toTex(options)}}`;
    },
    div(node, options) {
        return `{{\\frac{d}{d${node.args[0].toTex(options)}}}{\\left(${node.args[1].toTex(options)}\\right)}}`
    },
    mod(node, options) {
        return `\\operatorname{mod}\\left(${node.args[0].toTex(options)},\\ ${node.args[1].toTex(options)}\\right)`;
    },
    abs(node, options) {
        return `\\left|${node.args[0].toTex(options)}\\right|`;
    },
    floor(node, options) {
        return `\\left\\lfloor ${node.args[0].toTex(options)}\\right\\rfloor `;
    },
    ceil(node, options) {
        return `\\left\\lceil ${node.args[0].toTex(options)}\\right\\rceil `;
    },
    point(node, options) {
        return `\\left(${node.args.map(arg => arg.toTex(options)).join(",")}\\right)`
    },
    array(node, options) {
        return `\\left[${node.args.map(arg => arg.toTex(options)).join(",")}\\right]`
    },
    array_idx(node, options) {
        let arr = node.args[0].toTex(options);
        if(node.args[0].type === "OperatorNode") arr = `(${arr})`;

        return `${arr}\\left[${node.args[1].toTex(options)}\\right]`;
    },
    array_filter(node, options) {
        let arr = node.args[0].toTex(options);
        if(node.args[0].type === "OperatorNode") arr = `(${arr})`;

        return `${arr}\\left[${node.args[1].toTex(options)}=1\\right]`;
    },
    array_map(node, options) {
        return `\\left[${node.args[1].toTex(options)}\\ \\operatorname{for}\\ ${node.args[2].toTex(options)}=${node.args[0].toTex(options)}\\right]`;
    },
    range(node, options) {
        return `\\left[${node.args[0].toTex(options)}...${node.args[1].toTex(options)}\\right]`;
    },
    equal(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}=${node.args[1].toTex(options)},0\\right\\}`;
    },
    notEqual(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}=${node.args[1].toTex(options)}:0,1\\right\\}`;
    },
    lt(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}<${node.args[1].toTex(options)},0\\right\\}`;
    },
    lte(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}\\le ${node.args[1].toTex(options)},0\\right\\}`;
    },
    gt(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}>${node.args[1].toTex(options)},0\\right\\}`;
    },
    gte(node, options) {
        return `\\left\\{${node.args[0].toTex(options)}\\ge ${node.args[1].toTex(options)},0\\right\\}`;
    },
    log_base(node, options) {
        return `\\log_{${node.args[0].toTex(options)}}\\left(${node.args[1].toTex(options)}\\right)`;
    }
};

const builtinNames = [...builtinZeroArg, ...builtinOneArg, ...builtinTwoArgs, ...builtinThreeArgs, ...builtinMultiArgs, ...constants, ...Object.keys(functions), ...Object.keys(texFunctions)];
