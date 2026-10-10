import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("publisher",pathlib.Path(__file__).parents[1]/"publish-results.py")
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)

class Publishing(unittest.TestCase):
    def test_concurrent_results_and_a_pending_rebase_do_not_clobber_work(self):
        with tempfile.TemporaryDirectory(prefix="oracle-publish-test-") as temp:
            base=pathlib.Path(temp);remote=base/"remote.git";local=base/"local";other=base/"other"
            def run(*args,check=True):return subprocess.run(args,check=check,capture_output=True)
            run("git","init","--bare",str(remote));run("git","clone",str(remote),str(local))
            for repo in (local,):
                run("git","-C",str(repo),"config","user.name","Fixture");run("git","-C",str(repo),"config","user.email","fixture@invalid.test")
            run("git","-C",str(local),"checkout","-b","main")
            name=".github/oracle-fixture-result.json";(local/".github").mkdir()
            def write(repo,minute):
                (repo/name).write_text(json.dumps({"finished":"2026-10-10T09:"+minute+":00Z","result":{"status":"fixture-"+minute}}))
            def commit(repo):
                run("git","-C",str(repo),"add","--",name);run("git","-C",str(repo),"commit","-m","Fixture evidence")
            write(local,"00");commit(local);run("git","-C",str(local),"push","-u","origin","main")
            run("git","clone","--branch","main",str(remote),str(other))
            run("git","-C",str(other),"config","user.name","Fixture");run("git","-C",str(other),"config","user.email","fixture@invalid.test")
            write(other,"01");commit(other);(other/"notes.txt").write_text("Concurrent change")
            run("git","-C",str(other),"add","notes.txt");run("git","-C",str(other),"commit","-m","Concurrent unrelated change");run("git","-C",str(other),"push")
            head=run("git","-C",str(local),"rev-parse","HEAD").stdout
            (local/"user-work.txt").write_text("Keep this local work");write(local,"02")
            self.assertTrue(publisher.publish([name],local))
            self.assertEqual(run("git","-C",str(local),"rev-parse","HEAD").stdout,head)
            self.assertEqual((local/"user-work.txt").read_text(),"Keep this local work")
            self.assertEqual(run("git","--git-dir",str(remote),"show","main:notes.txt").stdout,b"Concurrent change")
            write(local,"01");self.assertFalse(publisher.publish([name],local))
            run("git","-C",str(local),"reset","--hard","origin/main")
            write(local,"03");commit(local)
            run("git","-C",str(other),"pull","--rebase");write(other,"04");commit(other);run("git","-C",str(other),"push")
            conflict=run("git","-C",str(local),"pull","--rebase","origin","main",check=False)
            self.assertNotEqual(conflict.returncode,0)
            write(local,"05");self.assertTrue(publisher.publish([name],local))
            latest=json.loads(run("git","--git-dir",str(remote),"show","main:"+name).stdout)
            self.assertEqual(latest["result"]["status"],"fixture-05")
            self.assertTrue((local/".git/rebase-merge").exists())
            self.assertEqual((local/"user-work.txt").read_text(),"Keep this local work")

if __name__=="__main__":unittest.main()
