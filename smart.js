/** 
 * @preserve jSmart Javascript template engine
 * http://code.google.com/p/jsmart/
 *
 * Copyright 2011, Max Miroshnikov <miroshnikov at gmail dot com> 
 * jSmart is licensed under the GNU General Public License
 * http://www.apache.org/licenses/LICENSE-2.0
 */


(function() {

    /**
       merges two or more objects into one and add prefix at the beginning of every property name at the top level
       objects type is lost, only own properties copied
    */
    function obMerge(prefix, ob1, ob2 /*, ...*/)
    {
        for (var i=2; i<arguments.length; ++i)
        {
            for (var nm in arguments[i]) 
            {
                if (arguments[i].hasOwnProperty(nm) || typeof arguments[i][nm] == 'function')
                {
                    if (typeof(arguments[i][nm]) == 'object' && arguments[i][nm] != null)
                    {
                        ob1[prefix+nm] = (arguments[i][nm] instanceof Array) ? new Array : new Object;
                        obMerge('', ob1[prefix+nm], arguments[i][nm]);
                    }
                    else
                    {
                        ob1[prefix+nm] = arguments[i][nm]; 
                    }
                }
            }
        }
        return ob1;
    }

    /**
       @return  number of own properties in ob
    */
    function countProperties(ob)
    {
        var count = 0;
        for (var nm in ob) 
        {
            if (ob.hasOwnProperty(nm))
            {
                count++; 
            }
        }
        return count;
    }

    /**
       @return  s trimmed and without quotes
    */
    function trimQuotes(s)
    {
        if (s.match(/^['"].*['"]$/))
        {
            s = eval(s);
        }
        return s.replace(/^\s+|\s+$/g,'');
    }

    /**
       finds first {tag} in string
       @param re string with regular expression
       @return  null or s.match(re) result object where 
       [0] - full tag matched with delimiters (and whitespaces at the begin and the end): { tag }
       [1] - found part from passed re
       [index] - position of tag starting { in s
    */
    function findTag(re,s)
    {
        var openCount = 0;
        var offset = 0;
        var ldelim = jSmart.prototype.left_delimiter;
        var rdelim = jSmart.prototype.right_delimiter;
        var skipInWS = jSmart.prototype.auto_literal;

        var reTag = new RegExp('^\\s*('+re+')\\s*$','i');

        for (var i=0; i<s.length; ++i)
        {
            if (s.substr(i,ldelim.length) == ldelim)
            {
                if (skipInWS && i+1 < s.length && s.substr(i+1,1).match(/\s/))
                {
                    continue;
                }
                if (!openCount)
                {
                    s = s.slice(i);
                    offset += i;
                    i = 0;
                }
                ++openCount;
            }
            else if (s.substr(i,rdelim.length) == rdelim)
            {
                if (skipInWS && i-1 >= 0 && s.substr(i-1,1).match(/\s/))
                {
                    continue;
                }
                if (!--openCount)
                {
                    var sTag = s.slice(ldelim.length,i).replace(/[\r\n]/g, ' ');
                    var found = sTag.match(reTag);
                    if (found)
                    {
                        found[0] = s.slice(0,i+rdelim.length);
                        found.index = offset;
                        return found;
                    }
                }
                if (openCount < 0) //ignore unmatched right delimiter
                {
                    openCount = 0;
                }
            }
        }
        return null;
    }

    function findCloseTag(reClose,reOpen,s)
    {
        var sInner = '';
        var closeTag = null;
        var openTag = null;
        var findIndex = 0;

        do 
        {
            if (closeTag)
            {
                findIndex += closeTag[0].length;
            }
            closeTag = findTag(reClose,s);
            if (!closeTag)
            {
                throw new Error('Unclosed {'+reOpen+'}');
            }
            sInner += s.slice(0,closeTag.index);
            findIndex += closeTag.index;
            s = s.slice(closeTag.index+closeTag[0].length);
            
            openTag = findTag(reOpen,sInner);
            if (openTag)
            {
                sInner = sInner.slice(openTag.index+openTag[0].length);
            }
        }
        while (openTag);

        closeTag.index = findIndex;
        return closeTag;
    }

    function findElseTag(reOpen, reClose, reElse, s)
    {
        var offset = 0;
        for (var elseTag=findTag(reElse,s); elseTag; elseTag=findTag(reElse,s))
        {
            var openTag = findTag(reOpen,s);
            if (!openTag || openTag.index > elseTag.index)
            {
                elseTag.index += offset;
                return elseTag;
            }
            else
            {
                s = s.slice(openTag.index+openTag[0].length);
                offset += openTag.index+openTag[0].length;
                var closeTag = findCloseTag(reClose,reOpen,s);
                s = s.slice(closeTag.index + closeTag[0].length);
                offset += closeTag.index + closeTag[0].length;
            }
        }
        return null;
    }

    function prepareVar(code)
    {
        return code.replace(/([$]\w+)@(index|iteration|first|last|show|total)/gi, "$1__$2");
    }

    function execute(code, data)
    {
        if (typeof(code) == 'string')
        {
            with (modifiers)
            {
                with (data)
                {
                    try {
                        return eval(code);
                    }
                    catch(e)
                    {
                        throw new Error(e.message + ' in \n' + code);
                    }
                }
            }
        }
        return code;
    }

    function assignVar(nm, val, data)
    {
        with ( {__data:data, __v: val} )
        { 
            if (nm.match(/\[\]$/))  //push to array
            {
                nm = nm.replace(/\[\]$/,'');
                eval('__data.'+nm+'.push(__v)'); 
            }
            else
            {
                eval('__data.'+nm+'=__v'); 
            }
        }
    }

    var buildInFunctions = 
        {
            __operator:
            {
                process: function(node, data)
                {
                    var params = getActualParamValues(node.params, data);
                    var args = {arg1: params[0]};

                    if (node.optype == 'binary')
                    {
                        args.arg2 = params[1];
                        if (node.op == '=')
                        {
                            getVarValue(node.params.__parsed[0], data, args.arg2);
                            return '';
                        }
                        else if (node.op.match(/(\+=|-=|\*=|\/=|%=)/))
                        {
                            args.arg1 = getVarValue(node.params.__parsed[0], data);
                            with (args) { eval('arg1' + node.op + 'arg2'); }
                            return getVarValue(node.params.__parsed[0], data, args.arg1);
                        }
                        else if (node.op.match(/div/))
                        {
                            with (args) { return eval('arg1%arg2'+(node.op=='div'?'==':'!=')+'0'); }
                        }
                        else if (node.op.match(/even/))
                        {
                            with (args) { return eval('(arg1/arg2)%2'+(node.op=='even'?'==':'!=')+'0'); }
                        }
                        else if (node.op.match(/xor/))
                        {
                            with (args) { return eval('(arg1 || arg2) && !(arg1 && arg2)'); }
                        }
                        with (args) { return eval('arg1 ' + node.op + ' arg2'); }
                    }
                    else if (node.op == '!')
                    {
                        with (args) { return eval('!arg1'); }
                    }
                    else 
                    {
                        var isVar = node.params.__parsed[0].type == 'var';
                        if (isVar)
                        {
                            args.arg1 = getVarValue(node.params.__parsed[0], data);
                        }
                        var v = args.arg1;
                        with (args)
                        {
                            if (node.optype == 'pre-unary')
                            {
                                v = eval(node.op+'arg1');
                                if (isVar)
                                {
                                    getVarValue(node.params.__parsed[0], data, args.arg1);
                                }
                            }
                            else
                            {
                                eval('arg1'+node.op);
                                getVarValue(node.params.__parsed[0], data, args.arg1);
                            }
                            return v;
                        }
                    }
                }
            },

            section: 
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    var subTree = [];
                    var subTreeElse = [];
                    tree.push({
                        type: 'build-in',
                        name: 'section',
                        params: params,
                        subTree: subTree,
                        subTreeElse: subTreeElse
                    });

                    var findElse = findElseTag('section [^}]+', '\/section', 'sectionelse', content);
                    if (findElse)
                    {
                        parse(content.slice(0,findElse.index),subTree);
                        parse(content.slice(findElse.index+findElse[0].length).replace(/^[\r\n]/,''), subTreeElse);
                    }
                    else
                    {
                        parse(content, subTree);
                    }            
                },

                process: function(node, data)
                {
                    var params = getActualParamValues(node.params, data);
                    params.loop = execute(node.params.loop, data);

                    var props = {};
                    data.$smarty.section[params.name] = props;

                    var show = params.__get('show',true);
                    props.show = show;
                    if (!show)
                    {
                        return process(node.subTreeElse, data);
                    }

                    var from = parseInt(params.__get('start',0));
                    var to = (params.loop instanceof Object) ? countProperties(params.loop) : isNaN(params.loop) ? 0 : parseInt(params.loop);
                    var step = parseInt(params.__get('step',1));
                    var max = parseInt(params.__get('max'));
                    if (isNaN(max))
                    {
                        max = Number.MAX_VALUE;
                    }

                    if (from < 0)
                    {
                        from = to + from;
                        if (from < 0)
                        {
                            from = 0;
                        }
                    }
                    else if (from >= to)
                    {
                        from = to ? to-1 : 0;
                    }

                    var count = 0;
                    var loop = 0;
                    var i = from;
                    for (; i>=0 && i<to && count<max; i+=step,++count) 
                    {
                        loop = i;
                    }
                    props.total = count;
                    props.loop = count;  //? - because it is so in Smarty

                    count = 0;
                    var s = '';
                    for (i=from; i>=0 && i<to && count<max; i+=step,++count)
                    {
                        props.first = (i==from);
                        props.last = ((i+step)<0 || (i+step)>=to);
                        props.index = i;
                        props.index_prev = i-step;
                        props.index_next = i+step;
                        props.iteration = props.rownum = count+1;

                        s += process(node.subTree, data);  
                    }
                    if (count)
                    {
                        return s;
                    }
                    return process(node.subTreeElse, data);
                }
            },

            'for':
            {
                type: 'block',
                parseParams: function(paramStr)
                {
                    var res = paramStr.match(/^\s*\$(\w+)\s*=\s*([^\s]+)\s*to\s*([^\s]+)\s*(?:step\s*([^\s]+))?\s*(.*)$/);
                    if (!res)
                    {
                        throw new Error('Invalid {for} parameters: '+paramStr);
                    }
                    return parseParams("varName='"+res[1]+"' from="+res[2]+" to="+res[3]+" step="+(res[4]?res[4]:'1')+" "+res[5]);
                },

                parse: function(params, tree, content)
                {
                    
                    var subTree = [];
                    var subTreeElse = [];
                    tree.push({
                        type: 'build-in',
                        name: 'for',
                        params: params,
                        subTree: subTree,
                        subTreeElse: subTreeElse
                    });

                    var findElse = findElseTag('for\\s[^}]+', '\/for', 'forelse', content);
                    if (findElse)
                    {
                        parse(content.slice(0,findElse.index),subTree);
                        parse(content.slice(findElse.index+findElse[0].length), subTreeElse);
                    }
                    else
                    {
                        parse(content, subTree);
                    }            
                },

                process: function(node, data)
                {
                    var params = getActualParamValues(node.params, data);
                    var from = parseInt(params.__get('from'));
                    var to = parseInt(params.__get('to'));
                    var step = parseInt(params.__get('step'));
                    if (isNaN(step))
                    {
                        step = 1;
                    }
                    var max = parseInt(params.__get('max'));
                    if (isNaN(max))
                    {
                        max = Number.MAX_VALUE;
                    }

                    var count = 0;
                    var s = '';
			           var total = Math.min( Math.ceil( ((step > 0 ? to-from : from-to)+1) / Math.abs(step)  ), max);
			           
                    for (var i=parseInt(params.from); count<total; i+=step,++count)
                    {
                        data['$'+params.varName] = i;
                        s += process(node.subTree, data);
                    }
                    if (!count)
                    {
                        s = process(node.subTreeElse, data);
                    }
                    return s;
                }
            },

            'if': 
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    var subTreeIf = [];
                    var subTreeElse = [];
                    tree.push({
                        type: 'build-in',
                        name: 'if',
                        params: params,
                        subTreeIf: subTreeIf,
                        subTreeElse: subTreeElse
                    });

                    var findElse = findElseTag('if\\s+[^}]+', '\/if', 'else[^}]*', content);
                    if (findElse)
                    {
                        parse(content.slice(0,findElse.index),subTreeIf);

                        content = content.slice(findElse.index+findElse[0].length);
                        var findElseIf = findElse[1].match(/^elseif(.*)/);
                        if (findElseIf)
                        {
                            buildInFunctions['if'].parse(parseParams(findElseIf[1]), subTreeElse, content.replace(/^\n/,''));
                        }
                        else
                        {
                            parse(content.replace(/^\n/,''), subTreeElse);
                        }
                    }
                    else
                    {
                        parse(content, subTreeIf);
                    }
                },

                process: function(node, data)
                {
                    if (getActualParamValues(node.params,data)[0])
                    {
                        return process(node.subTreeIf, data);
                    }
                    else
                    {
                        return process(node.subTreeElse, data);
                    }
                }
            },

            foreach: 
            {
                type: 'block',
                parseParams: function(paramStr)
                {
                    var params = {};
                    var res = paramStr.match(/^\s*[$](\w+)\s*as\s*[$](\w+)\s*(=>\s*[$](\w+))?\s*$/i);
                    if (res)
                    {
                        params.arrName = '$'+res[1];
                        params.varName = res[4] ? res[4] : res[2];
                        params.keyName = res[4] ? res[2] : null;
                    }
                    else    //Smarty 2.x syntax
                    {
                        params = parseParams(paramStr);
                        params.arrName = params['from'];
                        params.varName = trimQuotes(params['item']);
                        if ('key' in params)
                        {
                            params.keyName = trimQuotes(params['key']);
                        }
                        if ('name' in params)
                        {
                            params.loopName = trimQuotes(params['name']);
                        }
                    }
                    return params;
                },

                parse: function(params, tree, content)
                {
                    var subTree = [];
                    var subTreeElse = [];
                    tree.push({
                        type: 'build-in',
                        name: 'foreach',
                        arr: params.arrName,
                        keyName: params.keyName,
                        varName: '$'+params.varName,
                        loopName: params.loopName,
                        subTree: subTree,
                        subTreeElse: subTreeElse
                    });

                    var findElse = findElseTag('foreach\\s[^}]+', '\/foreach', 'foreachelse', content);
                    if (findElse)
                    {
                        parse(content.slice(0,findElse.index),subTree);
                        parse(content.slice(findElse.index+findElse[0].length).replace(/^[\r\n]/,''), subTreeElse);
                    }
                    else
                    {
                        parse(content, subTree);
                    }
                },

                process: function(node, data)
                {
                    var a = null;
                    try { a = execute(node.arr,data); } catch(e){}
                    if (!a)
                    {
                        a = trimQuotes(node.arr);
                    }
                    if (!(a instanceof Object))
                    {
                        a = [a];
                    }

                    var total = countProperties(a);

                    data[node.varName+'__total'] = total;
                    if (node.loopName)
                    {
                        data.$smarty.foreach[node.loopName] = {};
                        data.$smarty.foreach[node.loopName]['total'] = total;
                    }

                    var s='';
                    var i=0;
                    for (var key in a)
                    {
                        if (!a.hasOwnProperty(key))
                        {
                            continue;
                        }

                        data[node.varName+'__key'] = isNaN(key) ? key : parseInt(key);
                        if (node.keyName)
                        {
                            data['$'+node.keyName] = data[node.varName+'__key'];
                        }
                        data[node.varName] = a[key];
                        data[node.varName+'__index'] = parseInt(i);
                        data[node.varName+'__iteration'] = parseInt(i+1);
                        data[node.varName+'__first'] = (i===0);
                        data[node.varName+'__last'] = (i==total-1);
                        
                        if (node.loopName)
                        {
                            data.$smarty.foreach[node.loopName].index = parseInt(i);
                            data.$smarty.foreach[node.loopName].iteration = parseInt(i+1);
                            data.$smarty.foreach[node.loopName].first = (i===0) ? 1 : '';
                            data.$smarty.foreach[node.loopName].last = (i==total-1) ? 1 : '';
                        }

                        s += process(node.subTree, data);
                        ++i;
                    }
                    data[node.varName+'__show'] = (i>0);
                    if (node.loopName)
                    {
                        data.$smarty.foreach[node.loopName].show = (i>0) ? 1 : '';
                    }
                    if (i>0)
                    {
                        return s;                
                    }
                    return process(node.subTreeElse, data);
                }
            },

            'function': 
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    var subTree = [];
                    plugins[trimQuotes(params.name?params.name:params[0])] = 
                        {
                            type: 'function',
                            subTree: subTree,
                            defautParams: params,
                            process: function(params, data)
                            {
                                var defaults = getActualParamValues(this.defautParams,data);
                                delete defaults.name;
                                return process(this.subTree, obMerge('$',obMerge('',{},data),defaults,params));
                            }
                        };
                    parse(content.replace(/\n+$/,''), subTree);
                }
            },

            php:
            {
                type: 'block',
                parse: function(params, tree, content) {}
            },

            'extends':
            {
                type: 'function',
                parse: function(params, tree)
                {
                    var file = trimQuotes(params.file?params.file:params[0]);
                    var tpl = jSmart.prototype.getTemplate(file);
                    if (typeof(tpl) != 'string')
                    {
                        throw new Error('No template for '+ file);
                    }
                    parse(stripComments(tpl.replace(/\r\n/g,'\n')), tree);
                }
            },

            block:
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    tree.push({
                        type: 'build-in',
                        name: 'block',
                        params: params
                    });
                    
                    if (!('append' in params))
                    {
                        params.append = false;
                    }
                    if (!('prepend' in params))
                    {
                        params.prepend = false;
                    }

                    params.hasChild = params.hasParent = false;
                    onParseVar = function(nm) 
                    {
                        if (nm.match(/^\s*[$]smarty.block.child\s*$/))
                        {
                            params.hasChild = true;
                        }
                        if (nm.match(/^\s*[$]smarty.block.parent\s*$/))
                        {
                            params.hasParent = true;
                        }
                    }
                    var tree = parse(content, []);
                    onParseVar = function(nm) {}

                    var blockName = trimQuotes(params.name?params.name:params[0]);
                    if (!(blockName in blocks))
                    {
                        blocks[blockName] = [];
                    }
                    blocks[blockName].push({tree:tree, params:params});
                },

                process: function(node, data)
                {
                    data.$smarty.block.parent = data.$smarty.block.child = '';
                    var blockName = trimQuotes(node.params.name?node.params.name:node.params[0]);
                    this.processBlocks(blocks[blockName], blocks[blockName].length-1, data);
                    return data.$smarty.block.child;
                },

                processBlocks: function(blockAncestry, headIdx, data)
                {
                    var append = true;
                    var prepend = false;
                    var i = headIdx;
                    for (; i>=0; --i)
                    {
                        if (blockAncestry[i].params.hasParent)
                        {
                            var tmpChild = data.$smarty.block.child;
                            data.$smarty.block.child = '';
                            this.processBlocks(blockAncestry, i-1, data);
                            data.$smarty.block.parent = data.$smarty.block.child;
                            data.$smarty.block.child = tmpChild;
                        }

                        var tmpChild = data.$smarty.block.child;
                        var s = process(blockAncestry[i].tree, data);
                        data.$smarty.block.child = tmpChild;

                        if (blockAncestry[i].params.hasChild)
                        {
                            data.$smarty.block.child = s;
                        }
                        else if (append)
                        {
                            data.$smarty.block.child = s + data.$smarty.block.child;
                        }
                        else if (prepend)
                        {
                            data.$smarty.block.child += s;
                        }
                        append = blockAncestry[i].params.append;
                        prepend = blockAncestry[i].params.prepend;
                    }
                }
            },

            strip:
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    parse(content.replace(/[ \t]*[\r\n]+[ \t]*/g, ''), tree);
                }
            },

            literal:
            {
                type: 'block',
                parse: function(params, tree, content)
                {
                    parseText(content, tree);
                }
            },

            ldelim:
            {
                type: 'function',
                parse: function(params, tree)
                {
                    parseText(jSmart.prototype.left_delimiter, tree);
                }
            },

            rdelim:
            {
                type: 'function',
                parse: function(params, tree)
                {
                    parseText(jSmart.prototype.right_delimiter, tree);
                }
            }
        };

    var plugins = {};
    var modifiers = {};
    var files = {};
    var blocks = null;
    var scripts = null;

    function parse(s, tree)
    {
        var reTag = '.+';
        for (var openTag=findTag(reTag,s); openTag; openTag=findTag(reTag,s))
        {
            if (openTag.index)
            {
                parseText(s.slice(0,openTag.index),tree);
            }
            s = s.slice(openTag.index + openTag[0].length);

            var res = openTag[1].match(/^\s*(\w+)(.*)$/);
            if (res)         //function
            {
                var nm = res[1];
                var paramStr = (res.length>2) ? res[2] : '';

                if (nm in buildInFunctions)
                {
                    var buildIn = buildInFunctions[nm];
                    var params = ('parseParams' in buildIn)? buildIn.parseParams(paramStr) : parseParams(paramStr);
                    if (buildIn.type == 'block')
                    {
					         s = s.replace(/^\n/,'');  	//remove new line after block open tag (like in Smarty)
                        var closeTag = findCloseTag('\/'+nm, nm+' +[^}]*', s);
                        buildIn.parse(params, tree, s.slice(0,closeTag.index));
                        s = s.slice(closeTag.index+closeTag[0].length);
                    }
                    else
                    {
                        buildIn.parse(params, tree);
                        if (nm == 'extends')
                        {
                            tree = []; //throw away further parsing except for {block}
                        }
                    }
                    s = s.replace(/^\n/,'');
                }
                else if (nm in plugins)
                {
                    var plugin = plugins[nm];
                    if (plugin.type == 'block')
                    {
                        var closeTag = findCloseTag('\/'+nm, nm+' +[^}]*', s);
                        parsePluginBlock(nm, parseParams(paramStr), tree, s.slice(0,closeTag.index));
                        s = s.slice(closeTag.index+closeTag[0].length);
                    }
                    else if (plugin.type == 'function')
                    {
                        parsePluginFunc(nm, parseParams(paramStr), tree);
                    }
                    if (nm=='append' || nm=='assign' || nm=='capture' || nm=='eval' || nm=='include' || nm=='while' || nm=='nocache')
                    {
                        s = s.replace(/^\n/,'');
                    }
                }
                else   //variable
                {
                    tree.push( parseExpression(openTag[1]).tree );
                }
            }
            else         //variable
            {
                tree.push( parseExpression(openTag[1]).tree );
                if (tree[tree.length-1].type=='build-in' && tree[tree.length-1].name=='__operator' && tree[tree.length-1].op == '=')
                {
                    s = s.replace(/^\n/,'');
                }
            }
        }
        if (s) 
        {
            parseText(s, tree);
        }
        return tree;
    }

    function parseText(text, tree)
    {
        if (parseText.parseEmbeddedVars)
        {
            var re = /([$][\w@]+)|`([^`]*)`/;
            for (var found=text.match(re); found; found=text.match(re))
            {
                tree.push({type: 'text', data: text.slice(0,found.index)});
                tree.push( parseExpression(found[1] ? found[1] : found[2]).tree );
                text = text.slice(found.index + found[0].length);
            }
        }
        tree.push({type: 'text', data: text});
        return tree;
    }

    function parseFunc(name, params, tree)
    {
        params.__parsed.name = parseText(name,[])[0];
        tree.push({
            type: 'plugin',
            name: '__func',
            params: params
        });
        return tree;
    }

    function parseOperator(op, type, precedence, tree)
    {
        tree.push({
            type: 'build-in',
            name: '__operator',
            op: op,
            optype: type,
            precedence: precedence,
            params: {}
        });
    }

    function parseVar(s, e)
    {
        var rootName = prepareVar(e.token);
        var parts = [{type:'text', data:rootName}];

        var re = /^(?:\.|->|\[\s*)/;
        for (var op=s.match(re); op; op=s.match(re))
        {
            e.token += op[0];
            s = s.slice(op[0].length);

            var eProp = {value:'', tree:[]};
            if (op[0].match(/\[/))
            {
                eProp = parseExpression(s);
                if (eProp)
                {
                    e.token += eProp.value;
                    parts.push( eProp.tree );
                    s = s.slice(eProp.value.length);
                }

                var closeOp = s.match(/\s*\]/);
                if (closeOp)
                {
                    e.token += closeOp[0];
                    s = s.slice(closeOp[0].length);
                }
            }
            else
            {
                var parseMod = parseModifiers.stop;
                parseModifiers.stop = true;
                if (lookUp(s,eProp))
                {
                    e.token += eProp.value;
                    var part = eProp.tree[0];
                    if (part.type == 'plugin' && part.name == '__func')
                    {
                        part.hasOwner = true;
                    }
                    parts.push( part );
                    s = s.slice(eProp.value.length);
                }
                else
                {
                    eProp = false;
                }
                parseModifiers.stop = parseMod;
            }

            if (!eProp)
            {
                parts.push({type:'text', data:''});
            }
        }

        e.tree.push({type: 'var', parts: parts});

        e.value += e.token.substr(rootName.length);

        onParseVar(e.token);

        return s;
    }

    function onParseVar(nm)  {}


    var tokens = 
        [
            {
                re: /\$[\w@]+/,   //var
                parse: function(e, s)
                {
                    parseModifiers(parseVar(s, e), e);
                }
            },
            {
                re: /(true|false)/,  //bool
                parse: function(e, s)
                {
                    parseText(e.token.match(/true/i) ? '1' : '', e.tree);
                }
            },
            {
                re: /'[^'\\]*(?:\\.[^'\\]*)*'/, //single quotes
                parse: function(e, s)
                {
                    parseText(eval(e.token), e.tree);
                    parseModifiers(s, e);
                }
            },
            {
                re: /"[^"\\]*(?:\\.[^"\\]*)*"/,  //double quotes
                parse: function(e, s)
                {
                    var v = eval(e.token);
                    var isVar = v.match(tokens[0].re);
                    if (isVar)
                    {
                        var eVar = {token:isVar[0], tree:[]};
                        parseVar(v, eVar);
                        if (eVar.token.length == v.length)
                        {
                            e.tree.push( eVar.tree[0] );
                            return;
                        }
                    }

                    var tree = [];
                    parseText.parseEmbeddedVars = true;
                    parse(v, tree);
                    parseText.parseEmbeddedVars = false;
                    if (tree.length == 1)
                    {
                        e.tree.push(tree[0]);
                    }
                    else
                    {
                        e.tree.push({
                            type: 'plugin',
                            name: '__quoted',
                            params: {__parsed:tree}
                        });
                    }
                    parseModifiers(s, e);
                }
            },
            {
                re: /(\w+)\s*[(]/,  //func()
                parse: function(e, s)
                {
                    var fnm = RegExp.$1;
                    var params = parseParams(s,/^\s*,\s*/);
                    parseFunc(fnm, params, e.tree);
                    e.value += params.toString();
                    parseModifiers(s.slice(params.toString().length), e);
                }
            },
            {
                re: /\s*\(\s*/,  //expression in parentheses
                parse: function(e, s)
                {
                    var parens = [];
                    e.tree.push(parens);
                    parens.parent = e.tree;
                    e.tree = parens;
                }
            },
            {
                re: /\s*\)\s*/,
                parse: function(e, s)
                {
                    if (e.tree.parent) //it may be the end of func() or (expr)
                    {
                        e.tree = e.tree.parent;
                    }
                }
            },
            {
                re: /\s*(\+\+|--)\s*/,
                parse: function(e, s)
                {
                    if (e.tree.length && e.tree[e.tree.length-1].type == 'var')
                    {
                        parseOperator(RegExp.$1, 'post-unary', 1, e.tree);
                    }
                    else
                    {
                        parseOperator(RegExp.$1, 'pre-unary', 1, e.tree);
                    }
                }
            },
            {
                re: /\s*(==|!=|===|!==)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1, 'binary', 6, e.tree);
                }
            },
            {
                re: /\s+(eq|ne|neq)\s+/,
                parse: function(e, s)
                {
                    var op = RegExp.$1.replace(/ne(q)?/,'!=').replace(/eq/,'==');
                    parseOperator(op, 'binary', 6, e.tree);
                }
            },
            {
                re: /\s*!\s*/,
                parse: function(e, s)
                {
                    parseOperator('!', 'pre-unary', 2, e.tree);
                }
            },
            {
                re: /\s+not\s+/,
                parse: function(e, s)
                {
                    parseOperator('!', 'pre-unary', 2, e.tree);
                }
            },
            {
                re: /\s*(=|\+=|-=|\*=|\/=|%=)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1, 'binary', 10, e.tree);
                }
            },
            {
                re: /\s*(\*|\/|%)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1, 'binary', 3, e.tree);
                }
            },
            {
                re: /\s+mod\s+/,
                parse: function(e, s)
                {
                    parseOperator('%', 'binary', 3, e.tree);
                }
            },
            {
                re: /\s*(\+|-)\s*/,
                parse: function(e, s)
                {
                    if (!e.tree.length || e.tree[e.tree.length-1].name == '__operator')
                    {
                        parseOperator(RegExp.$1, 'pre-unary', 4, e.tree);
                    }
                    else
                    {
                        parseOperator(RegExp.$1, 'binary', 4, e.tree);
                    }
                }
            },
            {
                re: /\s*(<|<=|>|>=|<>)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1.replace(/<>/,'!='), 'binary', 5, e.tree);
                }
            },
            {
                re: /\s+(lt|lte|le|gt|gte|ge)\s+/,
                parse: function(e, s)
                {
                    var op = RegExp.$1.replace(/lt/,'<').replace(/l(t)?e/,'<=').replace(/gt/,'>').replace(/g(t)?e/,'>=');
                    parseOperator(op, 'binary', 5, e.tree);
                }
            },
            {
                re: /\s+(is\s+(not\s+)?div\s+by)\s+/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$2?'div_not':'div', 'binary', 7, e.tree);
                }
            },
            {
                re: /\s+is\s+(not\s+)?(even|odd)(\s+by\s+)?\s*/,
                parse: function(e, s)
                {
                    var op = RegExp.$1 ? ((RegExp.$2=='odd')?'even':'even_not') : ((RegExp.$2=='odd')?'even_not':'even');
                    parseOperator(op, 'binary', 7, e.tree);
                    if (!RegExp.$3)
                    {
                        parseText('1', e.tree);
                    }
                }
            },
            {
                re: /\s*(&&)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1, 'binary', 8, e.tree);
                }
            },
            {
                re: /\s*(\|\|)\s*/,
                parse: function(e, s)
                {
                    parseOperator(RegExp.$1, 'binary', 9, e.tree);
                }
            },
            {
                re: /\s+and\s+/,
                parse: function(e, s)
                {
                    parseOperator('&&', 'binary', 11, e.tree);
                }
            },
            {
                re: /\s+xor\s+/,
                parse: function(e, s)
                {
                    parseOperator('xor', 'binary', 12, e.tree);
                }
            },
            {
                re: /\s+or\s+/,
                parse: function(e, s)
                {
                    parseOperator('||', 'binary', 13, e.tree);
                }
            },
            {
                re: /#(\w+)#/,  //config variable
                parse: function(e, s)
                {
                    var eVar = {token:'$smarty',tree:[]};
                    parseVar('.config.'+RegExp.$1, eVar);
                    e.tree.push( eVar.tree[0] );                    
                    parseModifiers(s, e);
                }
            },
            {
                re: /\s*\[\s*/,   //array
                parse: function(e, s)
                {
                    var params = parseParams(s, /^\s*,\s*/, /^('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|\w+)\s*=>\s*/);
                    parsePluginFunc('__array',params,e.tree);
                    e.value += params.toString();
                    var paren = s.slice(params.toString().length).match(/\s*\]/);
                    if (paren)
                    {
                        e.value += paren[0];
                    }
                }
            },
            {
                re: /[\d.]+/, //number
                parse: function(e, s)
                {
                    parseText(e.token, e.tree);
                    parseModifiers(s, e);
                }
            },
            {
                re: /\w+/, //static
                parse: function(e, s)
                {
                    parseText(e.token, e.tree);
                    parseModifiers(s, e);
                }
            }
        ];

    function parseModifiers(s, e)
    {
        if (parseModifiers.stop) 
        {
            return;
        }

        var modifier = s.match(/^\|(\w+)/);
        if (!modifier)
        {
            return;
        }

        e.value += modifier[0];

        var fnm = modifier[1]=='default' ? 'defaultValue' : modifier[1];
        s = s.slice(modifier[0].length).replace(/^\s+/,'');
        
        parseModifiers.stop = true;
        var params = [];
        for (var colon=s.match(/^\s*:\s*/); colon; colon=s.match(/^\s*:\s*/))
        {
            e.value += s.slice(0,colon[0].length);
            s = s.slice(colon[0].length);
            
            var param = {value:'', tree:[]};
            if (lookUp(s, param))
            {
                e.value += param.value;
                params.push(param.tree[0]);
                s = s.slice(param.value.length);
            }
            else
            {
                parseText('',params);
            }
        }
        parseModifiers.stop = false;
        
        params.unshift(e.tree.pop());  //modifiers have the highest priority
        e.tree.push(parseFunc(fnm,{__parsed:params},[])[0]);
        
        parseModifiers(s, e);  //modifiers can be combined
    }

    function lookUp(s,e)
    {
        if (!s)
        {
            return false;
        }

        if (s.match('^'+jSmart.prototype.left_delimiter))
        {
            var tag = findTag('.*',s);
            if (tag)
            {
                e.token = tag[0];
                e.value += tag[0];
                parse(tag[0], e.tree);
                parseModifiers(s.slice(e.value.length), e);
                return true;
            }
        }

        for (var i=0; i<tokens.length; ++i)
        {
            if (s.match(new RegExp('^'+tokens[i].re.source,'i')))
            {
                e.token = RegExp.lastMatch;
                e.value += RegExp.lastMatch;
                tokens[i].parse(e, s.slice(e.token.length));
                return true;
            }
        }
        return false;
    }

    function bundleOp(i, tree, precedence)
    {
        var op = tree[i];
        if (op.name == '__operator' && op.precedence == precedence && !op.params.__parsed)
        {
            if (op.optype == 'binary')
            {
                op.params.__parsed = [tree[i-1],tree[i+1]];
                tree.splice(i-1,3,op);
                return true;
            } 
            else if (op.optype == 'post-unary')
            {
                op.params.__parsed = [tree[i-1]];
                tree.splice(i-1,2,op);
                return true;
            }

            op.params.__parsed = [tree[i+1]];
            tree.splice(i,2,op);
        }
        return false;
    }

    function composeExpression(tree)
    {
        var i = 0;
        for (i=0; i<tree.length; ++i)
        {
            if (tree[i] instanceof Array)
            {
                tree[i] = composeExpression(tree[i])
            }
        }
        
        for (var precedence=1; precedence<14; ++precedence)
        {
            if (precedence==2 || precedence==10)
            {
                for (i=tree.length; i>0; --i)
                {
                    i -= bundleOp(i-1, tree, precedence);
                }
            }
            else
            {
                for (i=0; i<tree.length; ++i)
                {
                    i -= bundleOp(i, tree, precedence);
                }
            }
        }
        return tree[0]; //only one node must be left
    }

    function parseExpression(s)
    {
        var e = { value:'', tree:[] };
        while (lookUp(s.slice(e.value.length), e)){}
        if (!e.tree.length)
        {
            return false;
        }
        e.tree = composeExpression(e.tree);
        return e;
    }

    function parseParams(paramsStr, reDelim, reName)
	 {
		  var s = paramsStr.replace(/\n/g,' ').replace(/^\s+|\s+$/g,'');
		  var params = [];
        params.__parsed = [];
        var paramsStr = '';

        if (!s)
        {
            return params;
        }

        if (!reDelim)
        {
            reDelim = /^\s+/;
            reName = /^(\w+)\s*=\s*/;
        }

        while (s)
        {
            var nm = null;
            if (reName)
            {
                var foundName = s.match(reName);
                if (foundName)
                {
                    nm = trimQuotes(foundName[1]);
                    paramsStr += s.slice(0,foundName[0].length);
                    s = s.slice(foundName[0].length);
                }
            }

            var param = parseExpression(s);
            if (!param)
            {
                break;
            }
            
		      if (nm)
		      {
				    params[nm] = param.value;
                params.__parsed[nm] = param.tree; 
		      }
		      else
		      {
				    params.push(param.value);
                params.__parsed.push(param.tree);

                if (isNaN(param.value))
                {
                    params[param.value] = true;
                    params.__parsed[param.value] = parseText('1',[]);
                }
		      }

            paramsStr += s.slice(0,param.value.length);
            s = s.slice(param.value.length);

            var foundDelim = s.match(reDelim);
            if (foundDelim)
            {
                paramsStr += s.slice(0,foundDelim[0].length);
                s = s.slice(foundDelim[0].length);
            }
            else
            {
                break;
            }
        }
        params.toString = function() { return paramsStr; }
		  return params;
	 }

    function parsePluginBlock(name, params, tree, content)
    {
        tree.push({
            type: 'plugin',
            name: name,
            params: params,
            subTree: parse(content,[])
        });
    }

    function parsePluginFunc(name, params, tree)
    {
        tree.push({
            type: 'plugin',
            name: name,
            params: params
        });
    }

    function getActualParamValues(params,data)
    {
        var actualParams = [];
        for (var nm in params.__parsed)
        {
            if (params.__parsed.hasOwnProperty(nm))
            {
                var v = process([params.__parsed[nm]], data);
                if (typeof(v) == 'string' && v.match(/^[1-9]\d*$/) && !isNaN(v))
                {
                    v = parseInt(v,10);
                }
                actualParams[nm] = v;
            }
        }

        actualParams.__get = function(nm,defVal,id)
        {
            if (nm in actualParams && typeof(actualParams[nm]) != 'undefined')
            {
                return actualParams[nm];
            }
            if (typeof(id)!='undefined' && typeof(actualParams[id]) != 'undefined')
            {
                return actualParams[id];
            }
            if (defVal === null)
            {
                throw new Error("The required attribute '"+nm+"' is missing");
            }
            return defVal;
        };
        return actualParams;
    }

    function getVarValue(node, data, val)
    {
        var v = data;
        var nm = '';
        for (var i=0; i<node.parts.length; ++i)
        {
            var part = node.parts[i];
            if (part.type == 'plugin' && part.name == '__func' && part.hasOwner)
            {
                data.__owner = v;
                v = process([node.parts[i]],data);
                delete data.__owner;
            }
            else
            {
                nm = process([part],data);

                //section name
                if (nm in data.$smarty.section && part.type=='text' && process([node.parts[0]],data)!='$smarty')
                { 
                    nm = data.$smarty.section[nm].index;
                }

                //add to array
                if (!nm && typeof val != 'undefined' && v instanceof Array)
                {
                    nm = v.length;
                }

                //set new value
                if (typeof val != 'undefined' && i==node.parts.length-1)
                {
                    v[nm] = val;
                }

                if (typeof v == 'object' && nm in v)
                {
                    v = v[nm];
                }
                else
                {
                    if (typeof val == 'undefined')
                    {
                        return '';
                    }
                    v[nm] = {};
                    v = v[nm];
                }
            }
        }
        return v;
    }

    function process(tree, data)
    {
        var res = '';
        for (var i=0; i<tree.length; ++i)
        {
            var s = '';
            var node = tree[i];
            if (node.type == 'text')
            {
                s = node.data;
            }
            else if (node.type == 'var')
            {
                s = getVarValue(node,data);
            }
            else if (node.type == 'build-in')
            {
                s = buildInFunctions[node.name].process(node,data);
            }
            else if (node.type == 'plugin')
            {
                var plugin = plugins[node.name];
                if (plugin.type == 'block')
                {
                    var repeat = {value:true};
                    plugins[node.name].process(getActualParamValues(node.params,data), '', data, repeat);
                    while (repeat.value)
                    {
                        repeat.value = false;
                        s += plugins[node.name].process(
                            getActualParamValues(node.params,data), 
                            process(node.subTree, data), 
                            data, 
                            repeat
                        );
                    }
                }
                else if (plugin.type == 'function')
                {
                    s = plugins[node.name].process(getActualParamValues(node.params,data), data);
                }
            }
            if (typeof s == 'boolean')
            {
                s = s ? '1' : '';
            }
            if (tree.length == 1)
            {
                return s;
            }
            res += s;
        }
        return res;    
    }

    function stripComments(s)
    {
        var sRes = '';
        for (var openTag=s.match(/{\*/); openTag; openTag=s.match(/{\*/))
        {
            sRes += s.slice(0,openTag.index);
            s = s.slice(openTag.index+openTag[0].length);
            var closeTag = s.match(/\*}/);
            if (!closeTag)
            {
                throw new Error('Unclosed {*');
            }
            s = s.slice(closeTag.index+closeTag[0].length);
            if (sRes.match(/\n+$/) && s.match(/^\n+/))
            {
                sRes = sRes.replace(/\n+$/,'\n');
                s = s.replace(/^\n/,'')
            }
        }
        return sRes + s;
    }


    jSmart = function(tpl)
    {
        this.tree = [];
        this.blocks = {};
        this.scripts = {};
        this.data = {
            '$smarty': {
                block: {},
                capture: {},
                counter: {},
                cycle: {},
                foreach: {},
                section: {},
                now: Math.floor( (new Date()).getTime()/1000 ),
                'const': {},
                config: {},
                current_dir: '/',
                template: '',
                ldelim: jSmart.prototype.left_delimiter,
                rdelim: jSmart.prototype.right_delimiter,
                version: '2.3'
            }
        };
        blocks = this.blocks;
        parse(stripComments(tpl.replace(/\r\n/g,'\n')), this.tree);
    };

    jSmart.prototype.fetch = function(data)
    {
        blocks = this.blocks;
        scripts = this.scripts;
        this.data = obMerge('$',this.data,data);
        var res = process(this.tree, this.data);
        if (jSmart.prototype.debugging)
        {
            plugins.debug.process([],this.data);
        }
        return res;
    };

    /**
       @param type  valid values are 'function', 'block' or 'modifier'
       @param callback  func(params,data)  or  block(params,content,data,repeat)
    */
    jSmart.prototype.registerPlugin = function(type, name, callback)
    {
        if (type == 'modifier')
        {
            modifiers[name] = callback;
        }
        else
        {
            plugins[name] = {'type': type, 'process': callback};
        }
    };

    jSmart.prototype.configLoad = function(confValues, section, data)
    {
        data = data ? data : this.data;
        var s = confValues.replace(/\r\n/g,'\n').replace(/^\s+|\s+$/g,'');
        var re = /^\s*(?:\[([^\]]+)\]|(?:(\w+)[ \t]*=[ \t]*("""|'[^'\\\n]*(?:\\.[^'\\\n]*)*'|"[^"\\\n]*(?:\\.[^"\\\n]*)*"|[^\n]*)))/m;
        var currSect = '';
        for (var f=s.match(re); f; f=s.match(re))
        {
	         s = s.slice(f.index+f[0].length);
	         if (f[1])
	         {
		          currSect = f[1];
	         }
	         else if ((!currSect || currSect == section) && currSect.substr(0,1) != '.')
	         {
		          if (f[3] == '"""')
		          {
			           var triple = s.match(/"""/);
			           if (triple)
			           {
				            data.$smarty.config[f[2]] = s.slice(0,triple.index);
				            s = s.slice(triple.index + triple[0].length);
			           }
		          }
		          else
		          {
			           data.$smarty.config[f[2]] = trimQuotes(f[3]);
		          }
	         }
	         var newln = s.match(/\n+/);
	         if (newln)
	         {
		          s = s.slice(newln.index + newln[0].length);
	         }
	         else
	         {
		          break;
	         }
        }
    }

    jSmart.prototype.clearConfig = function(varName)
    {
        if (varName)
        {
            delete this.data.$smarty.config[varName];
        }
        else
        {
            this.data.$smarty.config = {};
        }
    }

    /**
       override this function
       @param name  value of 'file' parameter in {include} and {extends}
       @return template text
    */
    jSmart.prototype.getTemplate = function(name)
    {
        throw new Error('No template for ' + name);
    }

    /**
       override this function
       @param name  value of 'file' parameter in {fetch}
       @return file content
    */
    jSmart.prototype.getFile = function(name)
    {
        throw new Error('No file for ' + name);
    }

    /**
       override this function
       @param name  value of 'file' parameter in {include_php} and {include_javascript} 
                     or value of 'script' parameter in {insert}
       @return Javascript script
    */
    jSmart.prototype.getJavascript = function(name)
    {
        throw new Error('No Javascript for ' + name);
    }

    /**
       override this function
       @param name  value of 'file' parameter in {config_load}
       @return config file content
    */
    jSmart.prototype.getConfig = function(name)
    {
        throw new Error('No config for ' + name);
    }



    /**     
       whether to skip tags in open brace { followed by white space(s) and close brace } with white space(s) before
    */
    jSmart.prototype.auto_literal = true;

    jSmart.prototype.left_delimiter = '{';
    jSmart.prototype.right_delimiter = '}';

    /** enables the debugging console */
    jSmart.prototype.debugging = false;


    jSmart.prototype.PHPJS = function(fnm, modifier)
    {
        if (eval('typeof '+fnm) == 'function')
        {
            return window;
        }
        else if (typeof(PHP_JS) == 'function')
        {
            return new PHP_JS();
        }
        throw new Error("Modifier '" + modifier + "' uses JavaScript port of PHP function '" + fnm + "'. You can find one at http://phpjs.org");
    }

    jSmart.prototype.makeTimeStamp = function(s)
    {
        if (!s)
        {
            return Math.floor( (new Date()).getTime()/1000 );
        }
        if (isNaN(s))
        {
            var tm = jSmart.prototype.PHPJS('strtotime','date_format').strtotime(s);
            if (tm == -1 || tm === false) {
                return Math.floor( (new Date()).getTime()/1000 );
            }
            return tm;
        }
        s = new String(s);
        if (s.length == 14) //mysql timestamp format of YYYYMMDDHHMMSS
        {
            return Math.floor( (new Date(s.substr(0,4),s.substr(4,2)-1,s.substr(6,2),s.substr(8,2),s.substr(10,2)).getTime()/1000 ) );
        }
        return parseInt(s);
    }



    /**
       register custom functions
    */
    jSmart.prototype.registerPlugin(
        'function', 
        '__array', 
        function(params, data)
        {
            var a = [];
            for (var nm in params)
            {
                if (params.hasOwnProperty(nm) && params[nm] && typeof params[nm] != 'function')
                {
                    a[nm] = params[nm];
                }
            }
            return a;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        '__func', 
        function(params, data)
        {
            var paramNames = [];
            var paramValues = {};
            for(var i=0; i<params.length; ++i)
            {
                paramNames.push(params.name+'__p'+i);
                paramValues[params.name+'__p'+i] = params[i];
            }
            var fname = ('__owner' in data && params.name in data.__owner) ? ('__owner.'+params.name) : params.name;
            return execute(fname + '(' + paramNames.join(',') + ')', obMerge('',{},data,paramValues));
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        '__quoted', 
        function(params, data)
        {
            return params.join('');
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'append', 
        function(params, data)
        {
            var varName = '$' + params.__get('var',null,0);
            if (!(varName in data) || !(data[varName] instanceof Array))
            {
                data[varName] = [];
            }
            var index = params.__get('index',false);
            var val = params.__get('value',null,1);
            if (index === false)
            {
                data[varName].push(val);
            }
            else
            {
                data[varName][index] = val;
            }
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'assign', 
        function(params, data)
        {
            assignVar('$'+params.__get('var',null,0), params.__get('value',null,1), data);
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'call', 
        function(params, data)
        {
            var fname = params.__get('name',null,0);
            delete params.name;
            var assignTo = params.__get('assign',false);
            delete params.assign;
            var s = plugins[fname].process(params, data);
            if (assignTo)
            {
                assignVar('$'+assignTo, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'block', 
        'capture', 
        function(params, content, data, repeat)
        {
            if (content)
            {
                content = content.replace(/^\n/,'');
                data.$smarty.capture[params.__get('name','default',0)] = content;

                if ('assign' in params)
                {
                    assignVar('$'+params.assign, content, data);
                }

                var append = params.__get('append',false);
                if (append)
                {
                    append = '$'+append;
				        if (append in data)
				        {
					         if (data[append] instanceof Array)
					         {
						          data[append].push(content);
					         }
				        }
				        else
				        {
					         data[append] = [content];
				        }
                }
            }
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'counter', 
        function(params, data)
        {
            var name = params.__get('name','default');
            if (name in data.$smarty.counter)
            {
                var counter = data.$smarty.counter[name];
                if ('start' in params)
                {
                    counter.value = parseInt(params['start']);
                }
                else
                {
                    counter.value = parseInt(counter.value);
                    counter.skip = parseInt(counter.skip);
                    if ('down' == counter.direction)
                    {
                        counter.value -= counter.skip;
                    }
                    else
                    {
                        counter.value += counter.skip;
                    }
                }
                counter.skip = params.__get('skip',counter.skip);
                counter.direction = params.__get('direction',counter.direction);
                counter.assign = params.__get('assign',counter.assign);
            }
            else
            {
                data.$smarty.counter[name] = {
                    value: parseInt(params.__get('start',1)),
                    skip: parseInt(params.__get('skip',1)),
                    direction: params.__get('direction','up'),
                    assign: params.__get('assign',false)
                };
            }

            if (data.$smarty.counter[name].assign)
            {
                data['$'+data.$smarty.counter[name].assign] = data.$smarty.counter[name].value;
                return '';
            }

            if (params.__get('print',true))
            {
                return data.$smarty.counter[name].value;
            }

            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'cycle', 
        function(params, data)
        {
            var name = params.__get('name','default');
            var reset = params.__get('reset',false);
            if (!(name in data.$smarty.cycle))
            {
                data.$smarty.cycle[name] = {arr: [''], delimiter: params.__get('delimiter',','), index: 0};
                reset = true;
            }

            if (params.__get('delimiter',false))
            {
                data.$smarty.cycle[name].delimiter = params.delimiter;
            }
            var values = params.__get('values',false);
            if (values)
            {
                var arr = [];
                if (values instanceof Object)
                {
                    for (nm in values)
                    {
                        arr.push(values[nm]);
                    }
                }
                else
                {
                    arr = values.split(data.$smarty.cycle[name].delimiter);
                }
                
                if (arr.length != data.$smarty.cycle[name].arr.length || arr[0] != data.$smarty.cycle[name].arr[0])
                {
                    data.$smarty.cycle[name].arr = arr;
                    data.$smarty.cycle[name].index = 0;
                    reset = true;
                }
            }

            if (params.__get('advance','true'))
            {
                data.$smarty.cycle[name].index += 1;
            }
            if (data.$smarty.cycle[name].index >= data.$smarty.cycle[name].arr.length || reset)
            {
                data.$smarty.cycle[name].index = 0;
            }

            if (params.__get('assign',false))
            {
                assignVar('$'+params.assign, data.$smarty.cycle[name].arr[ data.$smarty.cycle[name].index ], data);
                return '';
            }

            if (params.__get('print',true))
            {
                return data.$smarty.cycle[name].arr[ data.$smarty.cycle[name].index ];
            }

            return '';
        }
    );

    jSmart.prototype.print_r = function(v,indent)
    {
        if (v instanceof Object)
        {
            var s = ((v instanceof Array) ? 'Array['+v.length+']' : 'Object') + '<br>';
            for (var nm in v)
            {
                if (v.hasOwnProperty(nm))
                {
                    s += indent + '&nbsp;&nbsp;<strong>' + nm + '</strong> : ' + jSmart.prototype.print_r(v[nm],indent+'&nbsp;&nbsp;&nbsp;') + '<br>';
                }
            }
            return s;
        }
        return v;
    }

    jSmart.prototype.registerPlugin(
        'function', 
        'debug', 
        function(params, data)
        {
            if (typeof dbgWnd != 'undefined')
            {
                dbgWnd.close();
            }
            dbgWnd = window.open('','','width=680,height=600,resizable,scrollbars=yes');
            var sVars = '';
            var i=0;
            for (var nm in data)
            {
                sVars += '<tr class=' + (++i%2?'odd':'even') + '><td><strong>' + nm + '</strong></td><td>' + jSmart.prototype.print_r(data[nm],'') + '</td></tr>';
            }
            dbgWnd.document.write(" \
               <html xmlns='http://www.w3.org/1999/xhtml' xml:lang='en'> \
               <head> \
		            <title>jSmart Debug Console</title> \
                  <style type='text/css'> \
                     table {width: 100%;} \
                     td {vertical-align:top;width: 50%;} \
                     .even td {background-color: #fafafa;} \
                  </style> \
               </head> \
               <body> \
                  <h1>jSmart Debug Console</h1> \
                  <h2>assigned template variables</h2> \
                  <table>" + sVars + "</table> \
               </body> \
               </html> \
            ");
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'eval', 
        function(params, data)
        {
            var tree = [];
            parse(params.__get('var','',0), tree);
            var s = process(tree, data);
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'fetch', 
        function(params, data)
        {
            var s = jSmart.prototype.getFile(params.__get('file',null,0));
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_checkboxes', 
        function(params, data)
        {
            var type = params.__get('type','checkbox');
            var name = params.__get('name',type);
            if (type == 'checkbox')
            {
                name += '[]';
            }
            var values = params.__get('values',params.options);
            var output = params.__get('options',[]);
            var useName = ('options' in params);
            var p;
            if (!useName)
            {
                for (p in params.output)
                {
                    output.push(params.output[p]);
                }
            }
            var selected = params.__get('selected',false);
            var separator = params.__get('separator','');
            var labels = Boolean(params.__get('labels',true));

            var res = [];
            var i = 0;
            var s = '';
            for (p in values)
            {
                if (values.hasOwnProperty(p))
                {
                    s = (labels ? '<label>' : '');
                    s += '<input type="' + type + '" name="' + name + '" value="' + (useName ? p : values[p]) + '" ';
                    if (selected == (useName ? p : values[p]))
                    {
                        s += 'checked="checked" ';
                    }
                    s += '/>' + output[useName?p:i++];
                    s += (labels ? '</label>' : '');
                    s += separator;
                    res.push(s);
                }
            }
            if ('assign' in params)
            {
                assignVar('$'+params.assign, res, data);
                return '';
            }
            return res.join('\n');
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_image', 
        function(params, data)
        {
            var url = params.__get('file',null);
            var width = params.__get('width', false);
            var height = params.__get('height', false);
            var alt = params.__get('alt','');
            var href = params.__get('href',false);
            var path_prefix = params.__get('path_prefix','');
            var paramNames = {file:1,width:1,height:1,alt:1,href:1,basedir:1,path_prefix:1};

            var s = '<img src="' + path_prefix + url + '"' + ' alt="'+alt+'"' + (width ? ' width="'+width+'"':'') + (height ? ' height="'+height+'"':'');
            var p;
            for (p in params)
            {
                if (params.hasOwnProperty(p) && typeof(params[p]) == 'string')
                {
                    if (!(p in paramNames))
                    {
                        s += ' ' + p + '="' + params[p] + '"'; 
                    }
                }
            }
            s += ' />';
            return href ? '<a href="'+href+'">'+s+'</a>' : s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_options', 
        function(params, data)
        {
            var values = params.__get('values',params.options);
            var output = params.__get('options',[]);
            var useName = ('options' in params);
            var p;
            if (!useName)
            {
                for (p in params.output)
                {
                    output.push(params.output[p]);
                }
            }
            var selected = params.__get('selected',false);

            var res = [];
            var s = '';
            var i = 0;
            for (p in values)
            {
                if (values.hasOwnProperty(p))
                {
                    s = '<option value="' + (useName ? p : values[p]) + '"';
                    if (selected == (useName ? p : values[p]))
                    {
                        s += ' selected="selected"';
                    }
                    s += '>' + output[useName ? p : i++] + '</option>';
                    res.push(s);
                }
            }            
            var name = params.__get('name',false);
            return (name ? ('<select name="' + name + '">\n' + res.join('\n') + '\n</select>') : res.join('\n')) + '\n';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_radios',
        function(params, data)
        {
            params.type = 'radio';
            return plugins.html_checkboxes.process(params,data);
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_select_date',
        function(params, data)
        {
            var prefix = params.__get('prefix','Date_');
            var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

            var s = '';
            s += '<select name="'+prefix+'Month">\n';
            var i=0;
            for (i=0; i<months.length; ++i)
            {
                s += '<option value="' + i + '">' + months[i] + '</option>\n';
            }
            s += '</select>\n'

            s += '<select name="'+prefix+'Day">\n';
            for (i=0; i<31; ++i)
            {
                s += '<option value="' + i + '">' + i + '</option>\n';
            }
            s += '</select>\n'
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'html_table', 
        function(params, data)
        {
            var loop = [];
            var p;
            if (params.loop instanceof Array)
            {
                loop = params.loop
            }
            else
            {
                for (p in params.loop)
                {
                    if (params.loop.hasOwnProperty(p))
                    {
                        loop.push( params.loop[p] );
                    }
                }
            }
            var rows = params.__get('rows',false);
            var cols = params.__get('cols',false);
            if (!cols)
            {
                cols = rows ? Math.ceil(loop.length/rows) : 3;
            }
            var colNames = [];
            if (isNaN(cols))
            {
                if (typeof cols == 'object')
                {
                    for (p in cols)
                    {
                        if (cols.hasOwnProperty(p))
                        {
                            colNames.push(cols[p]);
                        }
                    }
                }
                else
                {
                    colNames = cols.split(/\s*,\s*/);
                }
                cols = colNames.length;
            }
            rows = rows ? rows : Math.ceil(loop.length/cols);
            
            var inner = params.__get('inner','cols');
            var caption = params.__get('caption','');
            var table_attr = params.__get('table_attr','border="1"');
            var th_attr = params.__get('th_attr',false);
            if (th_attr && typeof th_attr != 'object')
            {
                th_attr = [th_attr];
            }
            var tr_attr = params.__get('tr_attr',false);
            if (tr_attr && typeof tr_attr != 'object')
            {
                tr_attr = [tr_attr];
            }
            var td_attr = params.__get('td_attr',false);
            if (td_attr && typeof td_attr != 'object')
            {
                td_attr = [td_attr];
            }
            var trailpad = params.__get('trailpad','&nbsp;');
            var hdir = params.__get('hdir','right');
            var vdir = params.__get('vdir','down');

            var s = '';
            for (var row=0; row<rows; ++row)
            {
                s += '<tr' + (tr_attr ? ' '+tr_attr[row%tr_attr.length] : '') + '>\n';
                for (var col=0; col<cols; ++col)
                {
                    var idx = (inner=='cols') ? ((vdir=='down'?row:rows-1-row) * cols + (hdir=='right'?col:cols-1-col)) : ((hdir=='right'?col:cols-1-col) * rows + (vdir=='down'?row:rows-1-row));
                    
                    s += '<td' + (td_attr ? ' '+td_attr[col%td_attr.length] : '') + '>' + (idx < loop.length ? loop[idx] : trailpad) + '</td>\n';
                }
                s += '</tr>\n';
            }

            var sHead = '';
            if (colNames.length)
            {
                sHead = '\n<thead><tr>';
                for (var i=0; i<colNames.length; ++i)
                {
                    sHead += '\n<th' + (th_attr ? ' '+th_attr[i%th_attr.length] : '') + '>' + colNames[hdir=='right'?i:colNames.length-1-i] + '</th>';
                }
                sHead += '\n</tr></thead>';
            }

            return '<table ' + table_attr + '>' + (caption?'\n<caption>'+caption+'</caption>':'') + sHead + '\n<tbody>\n' + s + '</tbody>\n</table>\n';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'include', 
        function(params, data)
        {
            var file = params.__get('file',null,0);
            if (!(file in files))
            {
                files[file] = [];
                var tpl = jSmart.prototype.getTemplate(file);
                if (typeof(tpl) != 'string')
                {
                    throw new Error('No template for '+ file);
                }
                parse(stripComments(tpl.replace(/\r\n/g,'\n')), files[file]);
            }
            var incData = obMerge('$',obMerge('',{},data),params);
            incData.$smarty.template = file;
            var s = process(files[file], incData);
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'include_javascript', 
        function(params, data)
        {
            var file = params.__get('file',null,0);
            if (params.__get('once',true) && file in scripts)
            {
                return '';
            }
            scripts[file] = true;
            var s = execute(jSmart.prototype.getJavascript(file), {'$this':data});
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'include_php', 
        function(params, data)
        {
            return plugins['include_javascript'].process(params,data);
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'insert', 
        function(params, data)
        {
            var fparams = {};
            for (var nm in params)
            {
                if (params.hasOwnProperty(nm) && isNaN(nm) && params[nm] && typeof params[nm] == 'string' && nm != 'name' && nm != 'assign' && nm != 'script')
                {
                    fparams[nm] = params[nm];
                }
            }
            var prefix = 'insert_';
            if ('script' in params)
            {
                eval(jSmart.prototype.getJavascript(params.script));
                prefix = 'smarty_insert_';
            }
            var func = eval(prefix+params.__get('name',null,0));            
            var s = func(fparams, data);
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'block', 
        'javascript', 
        function(params, content, data, repeat)
        {
            data['$this'] = data;
            execute(content,data);
            delete data['$this'];
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'config_load', 
        function(params, data)
        {
            jSmart.prototype.configLoad(jSmart.prototype.getConfig(params.__get('file',null,0)), params.__get('section','',1), data);
            return '';
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'mailto', 
        function(params, data)
        {
            var address = params.__get('address',null);
            var encode = params.__get('encode','none');
            var text = params.__get('text',address);
            var cc = jSmart.prototype.PHPJS('rawurlencode','mailto').rawurlencode(params.__get('cc','')).replace('%40','@');
            var bcc = jSmart.prototype.PHPJS('rawurlencode','mailto').rawurlencode(params.__get('bcc','')).replace('%40','@');
            var followupto = jSmart.prototype.PHPJS('rawurlencode','mailto').rawurlencode(params.__get('followupto','')).replace('%40','@');
            var subject = jSmart.prototype.PHPJS('rawurlencode','mailto').rawurlencode( params.__get('subject','') );
            var newsgroups = jSmart.prototype.PHPJS('rawurlencode','mailto').rawurlencode(params.__get('newsgroups',''));
            var extra = params.__get('extra','');

            address += (cc?'?cc='+cc:'');
            address += (bcc?(cc?'&':'?')+'bcc='+bcc:'');
            address += (subject ? ((cc||bcc)?'&':'?') + 'subject='+subject : '');
            address += (newsgroups ? ((cc||bcc||subject)?'&':'?') + 'newsgroups='+newsgroups : '');
            address += (followupto ? ((cc||bcc||subject||newsgroups)?'&':'?') + 'followupto='+followupto : '');

            s = '<a href="mailto:' + address + '" ' + extra + '>' + text + '</a>';

            if (encode == 'javascript')
            {
                s = "document.write('" + s + "');";
                var sEncoded = '';
                for (var i=0; i<s.length; ++i)
                {
                    sEncoded += '%' + jSmart.prototype.PHPJS('bin2hex','mailto').bin2hex(s.substr(i,1));
                }
                return '<script type="text/javascript">eval(unescape(\'' + sEncoded + "'))</script>";
            }
            else if (encode == 'javascript_charcode')
            {
                var codes = [];
                for (var i=0; i<s.length; ++i) 
                {
                    codes.push(jSmart.prototype.PHPJS('ord','mailto').ord(s.substr(i,1)));
                } 
                return '<script type="text/javascript" language="javascript">\n<!--\n{document.write(String.fromCharCode('
                    + codes.join(',') + '))}\n//-->\n</script>\n';    
            }
            else if (encode == 'hex')
            {
                if (address.match(/^.+\?.+$/))
                {
                    throw new Error('mailto: hex encoding does not work with extra attributes. Try javascript.');
                }
                var aEncoded = '';
                for (var i=0; i<address.length; ++i)
                {
                    if (address.substr(i,1).match(/\w/))
                    {
                        aEncoded += '%' + jSmart.prototype.PHPJS('bin2hex','mailto').bin2hex(address.substr(i,1));
                    }
                    else
                    {
                        aEncoded += address.substr(i,1);
                    }
                }
                var tEncoded = '';
                for (var i=0; i<text.length; ++i)
                {
                    tEncoded += '&#x' + jSmart.prototype.PHPJS('bin2hex','mailto').bin2hex(text.substr(i,1)) + ';';
                }
                return '<a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;' + aEncoded + '" ' + extra + '>' + tEncoded + '</a>';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'function', 
        'math', 
        function(params, data)
        {
            with (Math)
            {
                with (params)
                {
                    var res = eval(params.__get('equation',null).replace(/pi\(\s*\)/g,'PI'));
                }
            }

            if ('format' in params)
            {
                res = jSmart.prototype.PHPJS('sprintf','math').sprintf(params.format,res);
            }

            if ('assign' in params)
            {
                assignVar('$'+params.assign, res, data);
                return '';
            }
            return res;
        }
    );

    jSmart.prototype.registerPlugin(
        'block', 
        'nocache', 
        function(params, content, data, repeat)
        {
            return content;
        }
    );

    jSmart.prototype.registerPlugin(
        'block', 
        'textformat', 
        function(params, content, data, repeat)
        {
            if (!content) {
                return '';
            }

            var wrap = params.__get('wrap',80);
            var wrap_char = params.__get('wrap_char','\n');
            var wrap_cut = params.__get('wrap_cut',false);
            var indent_char = params.__get('indent_char',' ');
            var indent = params.__get('indent',0);
            var indentStr = (new Array(indent+1)).join(indent_char);
            var indent_first = params.__get('indent_first',0);
            var indentFirstStr = (new Array(indent_first+1)).join(indent_char);

            var style = params.__get('style','');
            if (style == 'email')
            {
                wrap = 72;
            }

            var paragraphs = content.split('\n');
            for (var i=0; i<paragraphs.length; ++i)
            {
                var p = paragraphs[i];
                if (!p)
                {
                    continue;
                }
                p = p.replace(/^\s+|\s+$/,'').replace(/\s+/g,' ');
                if (indent_first)
                {
                    p = indentFirstStr + p;
                }

                p = modifiers.wordwrap(p, wrap-indent, wrap_char, wrap_cut);

                if (indent)
                {
                    p = p.replace(/^/mg,indentStr);
                }
                paragraphs[i] = p;
            }
            var s = paragraphs.join(wrap_char+wrap_char);
            if ('assign' in params)
            {
                assignVar('$'+params.assign, s, data);
                return '';
            }
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'block', 
        'while', 
        function(params, content, data, repeat)
        {
            if (content)
            {
                repeat.value = Boolean(params[0]);
                return repeat.value ? content.replace(/^\n/,'') : '';
            }
        }
    );



    /**
       register modifiers
    */
    jSmart.prototype.registerPlugin(
        'modifier', 
        'capitalize', 
        function(s, withDigits)
        {
            var re = new RegExp(withDigits ? '[\\W\\d]+' : '\\W+');
            var found = null;
            var res = '';
            for (found=s.match(re); found; found=s.match(re))
            {
	             var word = s.slice(0,found.index);
                if (word.match(/\d/))
                {
                    res += word;
                }
                else
                {
	                 res += word.charAt(0).toUpperCase() + word.slice(1);
                }
                res += s.slice(found.index, found.index+found[0].length);
	             s = s.slice(found.index+found[0].length);
            }
            if (s.match(/\d/))
            {
                return res + s;
            }
            return res + s.charAt(0).toUpperCase() + s.slice(1);
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'cat', 
        function(s, value)
        {
            value = value ? value : '';
            return s + value;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'count_characters', 
        function(s, includeWhitespaces)
        {
            return includeWhitespaces ? s.length : s.replace(/\s/g,'').length;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'count_paragraphs', 
        function(s)
        {
            var found = s.match(/\n+/g);
            if (found)
            {
	             return found.length+1;
            }
            return 1;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'count_sentences', 
        function(s)
        {
            var found = s.match(/[^\s]\.(?!\w)/g);
            if (found)
            {
	             return found.length;
            }
            return 0;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'count_words', 
        function(s)
        {
            var found = s.match(/\w+/g);
            if (found)
            {
	             return found.length;
            }
            return 0;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'date_format', 
        function(s, fmt, defaultDate)
        {
            return jSmart.prototype.PHPJS('strftime','date_format').strftime(fmt?fmt:'%b %e, %Y', jSmart.prototype.makeTimeStamp(s?s:defaultDate));
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'defaultValue',
        function(s, value)
        {
            return (s && s!='null' && s!='undefined') ? s : (value ? value : '');
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'escape', 
        function(s, esc_type, char_set)
        {
            esc_type = esc_type ? esc_type : 'html';
            char_set = char_set ? char_set : 'UTF-8';

            switch (esc_type) 
            {
            case 'html':
                return jSmart.prototype.PHPJS('htmlspecialchars','escape').htmlspecialchars(s, 3/*=ENT_QUOTES*/, char_set);
            case 'htmlall':
                return jSmart.prototype.PHPJS('htmlentities','escape').htmlentities(s, 3, char_set);
            case 'url':
                return jSmart.prototype.PHPJS('rawurlencode','escape').rawurlencode(s);
            case 'urlpathinfo':
                return jSmart.prototype.PHPJS('rawurlencode','escape').rawurlencode(s).replace(/%2F/g, '/');
            case 'quotes': 
                return s.replace(/([^\\])'/, "$1\\'");
            case 'hex':
                var res = '';
                for (var i=0; i<s.length; ++i) 
                {
                    res += '%' + jSmart.prototype.PHPJS('bin2hex','escape').bin2hex(s.substr(i,1));
                } 
                return res;
            case 'hexentity':
                var res = '';
                for (var i=0; i<s.length; ++i) {
                    res += '&#x' + jSmart.prototype.PHPJS('bin2hex','escape').bin2hex(s.substr(i,1)) + ';';
                } 
                return res;
            case 'decentity':
                var res = '';
                for (var i=0; i<s.length; ++i) {
                    res += '&#' + jSmart.prototype.PHPJS('ord','escape').ord(s.substr(i,1)) + ';';
                } 
                return res;
            case 'mail': 
                return s.replace(/@/g,' [AT] ').replace(/[.]/g,' [DOT] ');
            case 'nonstd': 
                var res = '';
                for (var i=0; i<s.length; ++i)
                {
                    var _ord = jSmart.prototype.PHPJS('ord','escape').ord(s.substr(i,1));
                    if (_ord >= 126) {
                        res += '&#' + _ord + ';';
                    } else {
                        res += s.substr(i, 1);
                    } 
                    
                }
                return res;
            case 'javascript': 
                return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/<\//g,'<\/');
            };
            return s;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'indent',
        function(s, repeat, indentWith)
        {
            repeat = repeat ? repeat : 4;
            indentWith = indentWith ? indentWith : ' ';
            
            var indentStr = '';
            while (repeat--)
            {
                indentStr += indentWith;
            }
            
            var tail = s.match(/\n+$/);
            return indentStr + s.replace(/\n+$/,'').replace(/\n/g,'\n'+indentStr) + (tail ? tail[0] : '');
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'lower', 
        function(s)
        {
            return s.toLowerCase();
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'nl2br', 
        function(s)
        {
            return s.replace(/\n/g,'<br />\n');
        }
    );

    /** 
        only modifiers (flags) 'i' and 'm' are supported 
        backslashes should be escaped e.g. \\s
    */
    jSmart.prototype.registerPlugin(
        'modifier', 
        'regex_replace',
        function(s, re, replaceWith)
        {
            var pattern = re.match(/^ *\/(.*)\/(.*) *$/);
            return (new String(s)).replace(new RegExp(pattern[1],'g'+(pattern.length>1?pattern[2]:'')), replaceWith);
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'replace',
        function(s, search, replaceWith)
        {
            if (!search)
            {
                return s;
            }
            s = new String(s);
            search = new String(search);
            replaceWith = new String(replaceWith);
            var res = '';
            var pos = -1;
            for (pos=s.indexOf(search,pos); pos>=0; pos=s.indexOf(search,pos))
            {
                res += s.slice(0,pos) + replaceWith;
                pos += search.length;
                s = s.slice(pos);
            }
            return res + s;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'spacify', 
        function(s, space)
        {
            if (!space)
            {
                space = ' ';
            }
            return s.replace(/(\n|.)(?!$)/g,'$1'+space);
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'string_format', 
        function(s, fmt)
        {
            return jSmart.prototype.PHPJS('sprintf','string_format').sprintf(fmt,s);
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'strip',
        function(s, replaceWith)
        {
            replaceWith = replaceWith ? replaceWith : ' ';
            return (new String(s)).replace(/[\s]+/g, replaceWith);
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'strip_tags',
        function(s, addSpace)
        {
            addSpace = (addSpace==null) ? true : addSpace;
            return (new String(s)).replace(/<[^>]*?>/g, addSpace ? ' ' : '');
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'truncate', 
        function(s, length, etc, breakWords, middle)
        {
            length = length ? length : 80;
            etc = (etc!=null) ? etc : '...';
            
            if (s.length <= length)
            {
                return s;
            }

            length -= Math.min(length,etc.length);
            if (middle)
            {
                //one of floor()'s should be replaced with ceil() but it so in Smarty 
                return s.slice(0,Math.floor(length/2)) + etc + s.slice(s.length-Math.floor(length/2));
            }

            if (!breakWords)
            {
                s = s.slice(0,length+1).replace(/\s+?(\S+)?$/,'');
            }
          
            return s.slice(0,length) + etc;
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'upper', 
        function(s)
        {
            return s.toUpperCase();
        }
    );

    jSmart.prototype.registerPlugin(
        'modifier', 
        'wordwrap', 
        function(s, width, wrapWith, breakWords)
        {
	         width = width ? width : 80;
	         wrapWith = wrapWith || '\n';
	         
	         var lines = s.split('\n');
	         for (var i=0; i<lines.length; ++i)
	         {
		          var line = lines[i];
                var parts = ''
		          while (line.length > width)
		          {
                   var pos = 0;
                   var found = line.slice(pos).match(/\s+/);
                   for (;found && (pos+found.index)<=width; found=line.slice(pos).match(/\s+/))
                   {
                      pos += found.index + found[0].length;
                   }
                   pos = pos || (breakWords ? width : (found ? found.index+found[0].length : line.length));
                   parts += line.slice(0,pos).replace(/\s+$/,'');// + wrapWith;
                   if (pos < line.length)
                   {
                      parts += wrapWith;
                   }
                   line = line.slice(pos);
                }
		          lines[i] = parts + line;
	         }
	         return lines.join('\n');
        }
    );


    String.prototype.fetch = function(data) 
    {
        var tpl = new jSmart(this);
        return tpl.fetch(data);
    };

})()