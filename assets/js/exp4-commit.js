(function($) {
  //Uses the https://github.com/github-tools/github library under the hood and exposes it as `gh` property
  function GithubAPI(auth) {
    let repo;
    let filesToCommit = [];
    let currentBranch = {};
    let newCommit = {};

    //the underlying library for making requests
    let gh = new GitHub(auth);

    /**
     * Sets the current repository to make push to
     * @public
     * @param {string} userName Name of the user who owns the repository
     * @param {string} repoName Name of the repository
     * @return void
     */
    this.setRepo = function(userName, repoName) {
      repo = gh.getRepo(userName, repoName);
    };

    /**
     * Sets the current branch to make push to. If the branch doesn't exist yet,
     * it will be created first
     * @public
     * @param {string} branchName The name of the branch
     * @return {Promise}
     */
    this.setBranch = function(branchName) {
      if (!repo) {
        throw 'Repository is not initialized';
      }

      return repo.listBranches().then(branches => {
        let branchExists = branches.data.find(
          branch => branch.name === branchName
        );
        if (!branchExists) {
          return repo.createBranch('master', branchName).then(() => {
            currentBranch.name = branchName;
          });
        } else {
          currentBranch.name = branchName;
        }
      });
    };

    /**
     * Makes the push to the currently set branch
     * @public
     * @param  {string}   message Message of the commit
     * @param  {object[]} files   Array of objects (with keys 'content' and 'path'),
     *                            containing data to push
     * @return {Promise}
     */
    this.pushFiles = function(message, files) {
      if (!repo) {
        throw 'Repository is not initialized';
      }
      if (!currentBranch.hasOwnProperty('name')) {
        throw 'Branch is not set';
      }

      return getCurrentCommitSHA()
        .then(getCurrentTreeSHA)
        .then(() => createFiles(files))
        .then(createTree)
        .then(() => createCommit(message))
        .then(updateHead)
        .catch(e => {
          console.error(e);
        });
    };

    /**
     * Sets the current commit's SHA
     * @private
     * @return {Promise}
     */
    function getCurrentCommitSHA() {
      return repo.getRef('heads/' + currentBranch.name).then(ref => {
        currentBranch.commitSHA = ref.data.object.sha;
      });
    }

    /**
     * Sets the current commit tree's SHA
     * @private
     * @return {Promise}
     */
    function getCurrentTreeSHA() {
      return repo.getCommit(currentBranch.commitSHA).then(commit => {
        currentBranch.treeSHA = commit.data.tree.sha;
      });
    }

    /**
     * Creates blobs for all passed files
     * @private
     * @param  {object[]} filesInfo Array of objects (with keys 'content' and 'path'),
     *                              containing data to push
     * @return {Promise}
     */
    function createFiles(filesInfo) {
      let promises = [];
      let length = filesInfo.length;

      for (let i = 0; i < length; i++) {
        promises.push(createFile(filesInfo[i]));
      }

      return Promise.all(promises);
    }

    /**
     * Creates a blob for a single file
     * @private
     * @param  {object} fileInfo Array of objects (with keys 'content' and 'path'),
     *                           containing data to push
     * @return {Promise}
     */
    function createFile(fileInfo) {
      // 此处repo是Github.js的API，createBlob需要魔改
      return repo.createBlob(fileInfo.content).then(blob => {
        filesToCommit.push({
          sha: blob.data.sha,
          path: fileInfo.path,
          mode: '100644',
          type: 'blob'
        });
      });
    }

    /**
     * Creates a new tree
     * @private
     * @return {Promise}
     */
    function createTree() {
      return repo
        .createTree(filesToCommit, currentBranch.treeSHA)
        .then(tree => {
          newCommit.treeSHA = tree.data.sha;
        });
    }

    /**
     * Creates a new commit
     * @private
     * @param  {string} message A message for the commit
     * @return {Promise}
     */
    function createCommit(message) {
      return repo
        .commit(currentBranch.commitSHA, newCommit.treeSHA, message)
        .then(commit => {
          newCommit.sha = commit.data.sha;
        });
    }

    /**
     * Updates the pointer of the current branch to point the newly created commit
     * @private
     * @return {Promise}
     */
    function updateHead() {
      return repo.updateHead('heads/' + currentBranch.name, newCommit.sha);
    }
  }

  function b64toBlob(b64Data, contentType, sliceSize) {
    contentType = contentType || '';
    sliceSize = sliceSize || 512;

    var byteCharacters = atob(b64Data);
    var byteArrays = [];

    for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      var slice = byteCharacters.slice(offset, offset + sliceSize);

      var byteNumbers = new Array(slice.length);
      for (var i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      var byteArray = new Uint8Array(byteNumbers);

      byteArrays.push(byteArray);
    }

    var blob = new Blob(byteArrays, { type: contentType });
    return blob;
  }

  // 必须是字符串，不能是对象！
  const ENCRYPTED_TOKEN =
    '{"iv":"wwZja1kyc6vnKMP+sXaRdg==","v":1,"iter":10000,"ks":128,"ts":64,"mode":"ccm","adata":"","cipher":"aes","salt":"MfCsdtUbCOQ=","ct":"ZMgE9geLS8jfirkqE4pK6R1K6slvcLwC2Vo2zYeKGW0Yq9sOY6ez5Utnte9MDQSl"}';

  const input = $('#input-upload');
  const button = $('#button-upload');
  const imgCap = $('#img-caption');
  const imgSel = $('#img-selected');

  imgCap.html('请选择图片');
  button.prop('disabled', true);

  let imgFile = null;
  let imgBase64 = null;
  let imgBase64Data = null;
  let imgBlob = null;
  const IMG_TYPE = 'image/jpg';
  const reader = new FileReader();
  reader.onload = () => {
    imgBase64 = reader.result;
    imgBase64Data = imgBase64.split(',')[1];
    imgBlob = b64toBlob(imgBase64Data, IMG_TYPE, 512);

    imgSel.prop('src', imgBase64);
    imgCap.html('加载完成，请点击按钮开始上传');
  };

  input.change(() => {
    button.prop('disabled', false);
    imgCap.html('图片加载中...');
    imgFile = input.prop('files')[0];
    if (imgFile.size > 1048576) {
      // 不允许上传大于 1MB 的文件
      imgCap.html('不允许上传大于1MB的图片，请重试');
      button.prop('disabled', true);
      return;
    }
    reader.readAsDataURL(imgFile);
    console.log(imgFile);
  });

  button.click(() => {
    button.prop('disabled', true);
    input.prop('disabled', true);
    imgCap.html('正在上传...');

    let pwd = prompt('为防止API被滥用，请输入上传密码：');
    let token;
    try {
      token = sjcl.decrypt(pwd, ENCRYPTED_TOKEN);
    } catch (e) {
      alert('密码不正确！' + e);
      imgCap.html('密码不正确，请重试。');
      button.prop('disabled', false);
      input.prop('disabled', false);
      return;
    }

    imgCap.html('密码正确。准备上传...');
    let api = new GithubAPI({
      token: token
    });
    api.setRepo('joxon', 'multimedia-web-design');
    api
      .setBranch('gh-pages')
      .then(() => {
        imgCap.html('正在上传...');
        api.pushFiles(`uploaded ${imgFile.name} to exp4/upload.jpg`, [
          {
            content: { content: imgBase64Data, encoding: 'base64' },
            path: 'exp4/upload.jpg'
          }
        ]);
      })
      .then(() => {
        imgCap.html('上传成功！');
      });

    button.prop('disabled', false);
    input.prop('disabled', false);
  });
})(jQuery);
